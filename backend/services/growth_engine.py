import math
from datetime import datetime
import numpy as np
from scipy.optimize import curve_fit

def logistic_model(t, K, r, t0, N0):
    """
    Standard sigmoidal microbial growth equation:
    N(t) = N0 + (K - N0) / (1 + exp(-r * (t - t0)))
    """
    return N0 + (K - N0) / (1.0 + np.exp(-np.clip(r * (t - t0), -50, 50)))

class GrowthEngine:
    @staticmethod
    def parse_iso(ts_str):
        if not ts_str:
            return datetime.utcnow()
        try:
            return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except Exception:
            return datetime.utcnow()

    @classmethod
    def analyze(cls, readings):
        """
        Takes list of dicts: [{'turbidity': float, 'temperature': float, 'ph': float, 'created_at': str}]
        Sorted oldest to newest.
        Returns comprehensive growth analysis, phases, predictions and chart projections.
        """
        if not readings:
            return cls._empty_response()

        # Sort readings by time just in case
        sorted_readings = sorted(readings, key=lambda r: cls.parse_iso(r.get("created_at")))
        n_points = len(sorted_readings)

        # Extract vectors
        turbidity_raw = [float(r.get("turbidity", 0.0)) for r in sorted_readings]
        temps = [float(r.get("temperature", 0.0)) for r in sorted_readings]
        phs = [float(r.get("ph", 0.0)) for r in sorted_readings]
        gases = [float(r.get("gas", 400.0)) for r in sorted_readings]
        timestamps = [cls.parse_iso(r.get("created_at")) for r in sorted_readings]

        # Calculate time offsets in hours relative to start of batch
        t0_time = timestamps[0]
        time_hours = [(ts - t0_time).total_seconds() / 3600.0 for ts in timestamps]

        # Moving average smoothing (window=3) to prevent sensor jitter
        turbidity_smooth = []
        for i in range(n_points):
            start_idx = max(0, i - 1)
            end_idx = min(n_points, i + 2)
            sub = turbidity_raw[start_idx:end_idx]
            turbidity_smooth.append(sum(sub) / len(sub))

        current_turb = turbidity_raw[-1]
        current_smooth = turbidity_smooth[-1]
        prev_turb = turbidity_raw[-2] if n_points > 1 else current_turb
        prev_smooth = turbidity_smooth[-2] if n_points > 1 else current_smooth

        current_temp = temps[-1]
        current_ph = phs[-1]
        current_gas = gases[-1]
        init_turb = turbidity_smooth[0]

        # -------------------------------------------------------------
        # 1. Growth Rate Calculation (Instant & Hourly)
        # -------------------------------------------------------------
        if n_points > 1:
            dt_hours = max((timestamps[-1] - timestamps[-2]).total_seconds() / 3600.0, 0.01)
            delta_turb = current_smooth - prev_smooth
            instant_growth_rate_per_hour = delta_turb / dt_hours
            percent_growth_rate = ((delta_turb / max(prev_smooth, 1.0)) / dt_hours) * 100.0
        else:
            delta_turb = 0.0
            instant_growth_rate_per_hour = 0.0
            percent_growth_rate = 0.0

        # Calculate series of derivative points for chart dN/dt
        derivative_series = []
        for i in range(n_points):
            if i == 0:
                rate = 0.0
            else:
                dt = max(time_hours[i] - time_hours[i-1], 0.01)
                rate = round((turbidity_smooth[i] - turbidity_smooth[i-1]) / dt, 2)
            derivative_series.append({
                "time_hr": round(time_hours[i], 2),
                "growth_rate_dndt": rate
            })

        # -------------------------------------------------------------
        # 2. Maximum History & Cumulative Increase
        # -------------------------------------------------------------
        max_turb = max(turbidity_smooth)
        total_growth_increase = current_smooth - init_turb
        overall_growth_ratio = (current_smooth / max(init_turb, 1.0))

        # -------------------------------------------------------------
        # 3. Curve Fitting & Predictive Future Projection
        # -------------------------------------------------------------
        fitted_K = max(max_turb * 1.05, 800.0)
        time_to_peak_hours = None
        predicted_points = []
        model_converged = False

        if n_points >= 5 and time_hours[-1] > 0.1:
            try:
                # Estimate initial guesses
                guess_K = max(max_turb * 1.1, init_turb * 1.5)
                guess_r = 0.5
                guess_t0 = time_hours[len(time_hours) // 2]
                guess_N0 = init_turb

                popt, _ = curve_fit(
                    logistic_model,
                    np.array(time_hours),
                    np.array(turbidity_smooth),
                    p0=[guess_K, guess_r, guess_t0, guess_N0],
                    bounds=([guess_K * 0.7, 0.01, 0.0, 0.0], [guess_K * 2.5, 5.0, 48.0, guess_K]),
                    maxfev=2000
                )
                fitted_K, fitted_r, fitted_t0, fitted_N0 = popt
                model_converged = True

                # Generate future projection points (next 5 hours)
                last_t = time_hours[-1]
                future_times = np.linspace(last_t, last_t + 5.0, 11)
                for ft in future_times:
                    pred_val = logistic_model(ft, fitted_K, fitted_r, fitted_t0, fitted_N0)
                    predicted_points.append({
                        "time_hr": round(float(ft), 2),
                        "predicted_turbidity": round(float(pred_val), 1)
                    })

                # Calculate estimated time until 95% of K is reached
                if current_smooth < 0.95 * fitted_K and fitted_r > 0.01:
                    # N(t) = K * 0.95 => solve for t
                    # 0.95 = 1 / (1 + exp(-r(t - t0))) => exp(-r(t-t0)) = 0.0526 => -r(t-t0) = ln(0.0526)
                    target_t = fitted_t0 - (math.log(0.0526) / fitted_r)
                    rem_t = target_t - last_t
                    if 0.1 <= rem_t <= 24.0:
                        time_to_peak_hours = round(rem_t, 1)

            except Exception:
                model_converged = False

        # If curve fitting did not converge or early stage, heuristic projection
        if not predicted_points:
            last_t = time_hours[-1]
            for ft in np.linspace(last_t, last_t + 4.0, 9):
                pred_val = min(current_smooth + (instant_growth_rate_per_hour * (ft - last_t)), fitted_K)
                predicted_points.append({
                    "time_hr": round(float(ft), 2),
                    "predicted_turbidity": round(float(pred_val), 1)
                })

        # -------------------------------------------------------------
        # 4. Phase Classification & Harvest Recommendation
        # -------------------------------------------------------------
        # Check decline/death phase:
        # Turbidity has peaked and dropped significantly below the historical maximum (>25 NTU decline)
        is_declining = (
            max_turb > 400.0 and (current_smooth <= max_turb - 25.0) and (instant_growth_rate_per_hour <= 2.0)
        )

        # Check lag phase:
        # Culture has not yet grown significantly from baseline (increase < 40 NTU or ratio < 1.25)
        is_lag = (
            (total_growth_increase < 45.0 or overall_growth_ratio < 1.25)
            and not is_declining
        )

        # Check stationary phase:
        # Significant growth occurred, close to carrying capacity/peak, and rate has flattened (small delta)
        is_stationary = (
            (total_growth_increase > 100.0 or overall_growth_ratio >= 1.5)
            and (current_smooth >= 0.94 * max_turb)
            and (abs(delta_turb) <= 3.5 or percent_growth_rate <= 2.5 or abs(instant_growth_rate_per_hour) <= 5.0)
            and not is_declining
            and not is_lag
        )

        # Check log/exponential phase:
        is_log = (
            not is_stationary
            and not is_declining
            and not is_lag
        )

        # Assemble phase details
        if is_declining:
            current_status = "Death / Decline Phase"
            phase_code = "death"
            estimated_peak = "Passed"
            recommendation = "Culture viability is declining due to toxic byproduct accumulation. Terminate incubation immediately and harvest existing biomass."
            badge_color = "red"
            growth_trend = "Declining"
        elif is_stationary:
            current_status = "Stationary Phase"
            phase_code = "stationary"
            estimated_peak = "Reached"
            recommendation = "Optimal harvest window reached! Culture has achieved peak biomass with growth rate approaching zero. Collect sample now for maximum yield."
            badge_color = "amber"
            growth_trend = "Plateaued"
        elif is_log:
            current_status = "Log (Exponential) Phase"
            phase_code = "log"
            rem_str = f"~{time_to_peak_hours} Hours Remaining" if time_to_peak_hours else "~2.5 Hours Remaining"
            estimated_peak = rem_str
            recommendation = "Rapid cellular division active. Substrate conversion in progress. Continue incubation, maintain aeration and temperature."
            badge_color = "emerald"
            growth_trend = "Accelerating"
        else: # Default or Lag
            current_status = "Lag Phase"
            phase_code = "lag"
            estimated_peak = "Estimating (Adaptation ongoing)"
            recommendation = "Microorganisms are synthesizing enzymes and adapting to the nutrient broth. Continue incubation at target temperature."
            badge_color = "blue"
            growth_trend = "Steady"

        # Environmental checks
        env_alerts = []
        if current_temp < 25.0:
            env_alerts.append({"type": "warning", "message": f"Temperature ({current_temp:.1f}°C) is below typical optimal bioprocess range (30-37°C)."})
        elif current_temp > 40.0:
            env_alerts.append({"type": "danger", "message": f"Temperature ({current_temp:.1f}°C) is dangerously high. Risk of thermal cell death."})

        if current_ph < 4.8:
            env_alerts.append({"type": "info", "message": f"Significant acidification detected (pH {current_ph:.2f}). Indicates vigorous organic acid metabolic secretion."})

        if current_gas > 2500.0:
            env_alerts.append({"type": "info", "message": f"Elevated headspace off-gas ({current_gas:.0f} PPM). High metabolic respiration/fermentation rate."})

        # -------------------------------------------------------------
        # 5. Phase Milestones Tracking (When start, log, peak, harvest, dying)
        # -------------------------------------------------------------
        milestones = {
            "inoculation_start": {
                "timestamp": timestamps[0].isoformat(),
                "time_hr": 0.0,
                "turbidity": round(turbidity_raw[0], 1),
                "ph": round(phs[0], 2),
                "gas": round(gases[0], 1)
            },
            "log_acceleration": None,
            "peak_biomass": None,
            "harvest_window": None,
            "decline_death": None
        }

        # Find log acceleration point
        for i in range(1, n_points):
            if (turbidity_smooth[i] - init_turb) >= 40.0:
                milestones["log_acceleration"] = {
                    "timestamp": timestamps[i].isoformat(),
                    "time_hr": round(time_hours[i], 2),
                    "turbidity": round(turbidity_raw[i], 1),
                    "gas": round(gases[i], 1)
                }
                break

        # Find peak biomass point
        peak_idx = int(np.argmax(turbidity_smooth))
        if peak_idx > 0 and (turbidity_smooth[peak_idx] - init_turb) > 60.0:
            milestones["peak_biomass"] = {
                "timestamp": timestamps[peak_idx].isoformat(),
                "time_hr": round(time_hours[peak_idx], 2),
                "turbidity": round(turbidity_raw[peak_idx], 1),
                "gas": round(gases[peak_idx], 1)
            }
            milestones["harvest_window"] = {
                "timestamp": timestamps[peak_idx].isoformat(),
                "time_hr": round(time_hours[peak_idx], 2),
                "status": "Optimal Harvest Window"
            }

        # Find decline/death point
        for i in range(peak_idx + 1, n_points):
            if turbidity_smooth[i] <= (max_turb - 25.0):
                milestones["decline_death"] = {
                    "timestamp": timestamps[i].isoformat(),
                    "time_hr": round(time_hours[i], 2),
                    "turbidity": round(turbidity_raw[i], 1),
                    "loss_ntu": round(max_turb - turbidity_raw[i], 1)
                }
                break

        # Calculate runtime in both hours and minutes
        total_dur_hours = round(time_hours[-1], 2) if time_hours else 0.0
        total_dur_minutes = int(round(total_dur_hours * 60))
        dur_h = total_dur_minutes // 60
        dur_m = total_dur_minutes % 60
        if dur_h == 0:
            dur_formatted = f"{dur_m} min" if dur_m > 0 else "< 1 min"
        else:
            dur_formatted = f"{dur_h}h {dur_m}m"

        return {
            "current_status": current_status,
            "phase_code": phase_code,
            "estimated_peak": estimated_peak,
            "growth_rate_pct": round(percent_growth_rate, 1),
            "growth_rate_abs": round(instant_growth_rate_per_hour, 1),
            "growth_rate_formatted": f"{percent_growth_rate:+.1f}% / hr" if abs(percent_growth_rate) > 0.05 else f"{instant_growth_rate_per_hour:+.1f} NTU/hr",
            "recommendation": recommendation,
            "badge_color": badge_color,
            "growth_trend": growth_trend,
            "latest_reading": {
                "turbidity": round(current_turb, 1),
                "temperature": round(current_temp, 1),
                "ph": round(current_ph, 2),
                "gas": round(current_gas, 1),
                "timestamp": timestamps[-1].isoformat(),
                "time_elapsed_hr": round(time_hours[-1], 2)
            },
            "metrics": {
                "initial_turbidity": round(init_turb, 1),
                "peak_turbidity": round(max_turb, 1),
                "peak_gas": round(max(gases), 1),
                "predicted_carrying_capacity_K": round(fitted_K, 1),
                "total_readings": n_points,
                "batch_duration_hours": total_dur_hours,
                "batch_duration_minutes": total_dur_minutes,
                "batch_duration_formatted": dur_formatted
            },
            "phase_milestones": milestones,
            "environmental_alerts": env_alerts,
            "predicted_projection": predicted_points,
            "growth_rate_series": derivative_series
        }

    @classmethod
    def _empty_response(cls):
        return {
            "current_status": "No Data Received",
            "phase_code": "unknown",
            "estimated_peak": "Awaiting Sensor Data",
            "growth_rate_pct": 0.0,
            "growth_rate_abs": 0.0,
            "growth_rate_formatted": "0.0% / hr",
            "recommendation": "Connect ESP32 or trigger simulation mode to begin bioprocess tracking.",
            "badge_color": "gray",
            "growth_trend": "Idle",
            "latest_reading": {
                "turbidity": 0.0,
                "temperature": 0.0,
                "ph": 7.0,
                "gas": 400.0,
                "timestamp": datetime.utcnow().isoformat(),
                "time_elapsed_hr": 0.0
            },
            "metrics": {
                "initial_turbidity": 0.0,
                "peak_turbidity": 0.0,
                "peak_gas": 400.0,
                "predicted_carrying_capacity_K": 800.0,
                "total_readings": 0,
                "batch_duration_hours": 0.0,
                "batch_duration_minutes": 0,
                "batch_duration_formatted": "0 min"
            },
            "phase_milestones": {
                "inoculation_start": None,
                "log_acceleration": None,
                "peak_biomass": None,
                "harvest_window": None,
                "decline_death": None
            },
            "environmental_alerts": [],
            "predicted_projection": [],
            "growth_rate_series": []
        }

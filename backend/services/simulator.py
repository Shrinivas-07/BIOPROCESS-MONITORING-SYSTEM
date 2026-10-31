import math
import random
from datetime import datetime, timedelta

class BioprocessSimulator:
    """
    Generates biologically accurate microbial growth curves (e.g. Saccharomyces cerevisiae / yeast fermentation)
    Simulating:
    - Turbidity: Lag phase (~100 NTU) -> Log phase (exponential climb to ~790 NTU) -> Stationary (~795 NTU)
    - pH: Drops as organic acids / CO2 are produced (7.1 -> 5.4)
    - Temperature: Controlled incubator around 30.2°C with realistic +/-0.4°C fluctuations
    - Gas: Headspace CO2/VOC sensor (MQ-135) tracks respiration (400 PPM -> 2900+ PPM)
    """

    @staticmethod
    def generate_batch_history(hours=10.0, step_minutes=15, target_phase="stationary"):
        """
        Generates a sequence of historical readings up to a target phase:
        - 'lag': first 2 hours
        - 'log': mid growth (~4.5 hours)
        - 'stationary': plateau (~8.5 hours)
        - 'death': extended (>12 hours)
        """
        duration_map = {
            "lag": 1.0,
            "log": 4.5,
            "stationary": 9.5,
            "death": 14.0
        }
        total_hours = duration_map.get(target_phase, hours)
        num_steps = int((total_hours * 60) / step_minutes) + 1
        
        now = datetime.utcnow()
        start_time = now - timedelta(hours=total_hours)

        readings = []
        K = 795.0      # Carrying capacity / Peak turbidity
        N0 = 105.0     # Initial turbidity
        r = 0.85       # Growth rate coefficient
        t0 = 4.2       # Inflection point (hours)

        for step in range(num_steps):
            t_hr = (step * step_minutes) / 60.0
            ts = start_time + timedelta(minutes=step * step_minutes)

            # Sigmoid / Logistic growth formula
            sigmoid_val = N0 + (K - N0) / (1.0 + math.exp(-r * (t_hr - t0)))
            noise = random.gauss(0, 1.8) # Small sensor jitter
            turbidity = max(N0, round(sigmoid_val + noise, 1))

            # Simulate death phase if beyond 10 hours
            if t_hr > 10.0:
                death_decay = (t_hr - 10.0) * 12.0
                turbidity = max(N0, round(turbidity - death_decay + noise, 1))

            # Temperature: maintained around 30.2°C +/- 0.3°C
            # Biological metabolic heat slightly warms culture during peak log phase
            temp_boost = 0.4 * (1.0 / (1.0 + math.exp(-r * (t_hr - t0)))) if t_hr < 8.0 else 0.0
            temp = round(30.0 + temp_boost + random.uniform(-0.15, 0.2), 1)

            # pH: Inverse relationship with biomass (organic acids decrease pH from 7.1 down to ~5.4)
            growth_fraction = min(1.0, max(0.0, (turbidity - N0) / (K - N0)))
            ph = round(7.10 - (1.65 * growth_fraction) + random.uniform(-0.02, 0.02), 2)

            # Gas (CO2 / Headspace Off-Gas in PPM)
            # Baseline is ~420 PPM in lag phase; surges to ~2900 PPM during rapid respiration (log phase)
            if t_hr <= 10.0:
                gas_val = 420.0 + (2500.0 * growth_fraction) + random.gauss(0, 20.0)
            else:
                # In death phase, metabolic respiration drops
                gas_decay = (t_hr - 10.0) * 180.0
                gas_val = max(550.0, 2920.0 - gas_decay + random.gauss(0, 20.0))
            gas = round(max(400.0, gas_val), 1)

            readings.append({
                "id": step + 1,
                "created_at": ts.isoformat() + "Z",
                "device_id": "ESP32_SIMULATOR",
                "turbidity": turbidity,
                "temperature": temp,
                "ph": ph,
                "gas": gas
            })

        return readings

    @staticmethod
    def generate_next_live_reading(last_reading):
        """
        Given the last reading dict, generates the next incremental reading 
        to simulate continuous real-time ESP32 updates.
        """
        if not last_reading:
            return {
                "created_at": datetime.utcnow().isoformat() + "Z",
                "device_id": "ESP32_SIMULATOR",
                "turbidity": 105.0,
                "temperature": 30.1,
                "ph": 7.08,
                "gas": 420.0
            }

        prev_turb = float(last_reading.get("turbidity", 105.0))
        prev_ph = float(last_reading.get("ph", 7.0))
        prev_temp = float(last_reading.get("temperature", 30.2))
        prev_gas = float(last_reading.get("gas", 420.0))

        # Determine growth delta based on current range
        if prev_turb < 200.0:
            # Lag to early log
            delta = random.uniform(2.0, 5.0)
            gas_delta = random.uniform(5.0, 15.0)
        elif prev_turb < 650.0:
            # High log phase
            delta = random.uniform(8.0, 16.0)
            gas_delta = random.uniform(30.0, 65.0)
        elif prev_turb < 785.0:
            # Late log phase slowing down
            delta = random.uniform(3.0, 7.0)
            gas_delta = random.uniform(10.0, 25.0)
        elif prev_turb < 796.0:
            # Stationary plateau approaching
            delta = random.uniform(0.1, 1.8)
            gas_delta = random.uniform(-5.0, 5.0)
        else:
            # Stationary oscillation
            delta = random.uniform(-0.8, 0.8)
            gas_delta = random.uniform(-8.0, 4.0)

        new_turb = round(prev_turb + delta, 1)
        new_temp = round(30.2 + random.uniform(-0.15, 0.15), 1)
        new_ph = round(max(5.3, prev_ph - (delta * 0.002) + random.uniform(-0.01, 0.01)), 2)
        new_gas = round(min(3200.0, max(400.0, prev_gas + gas_delta)), 1)

        return {
            "created_at": datetime.utcnow().isoformat() + "Z",
            "device_id": "ESP32_SIMULATOR",
            "turbidity": new_turb,
            "temperature": new_temp,
            "ph": new_ph,
            "gas": new_gas
        }

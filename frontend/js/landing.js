/**
 * Kinetic.Bio Landing Page Controller
 * Powers the interactive bioreactor kinetic scrubber, phase scrollytelling SVG highlight, and navigation
 */

document.addEventListener('DOMContentLoaded', () => {
  initCultureScrubber();
  initScrollytelling();
  initSmoothScroll();
});

// -------------------------------------------------------------
// 1. INTERACTIVE BIOREACTOR KINETIC SCRUBBER
// -------------------------------------------------------------
function initCultureScrubber() {
  const slider = document.getElementById('scrubberSlider');
  const timeDisplay = document.getElementById('scrubberTimeDisplay');
  const turbDisplay = document.getElementById('scrubberTurbDisplay');
  const tempDisplay = document.getElementById('scrubberTempDisplay');
  const phDisplay = document.getElementById('scrubberPhDisplay');
  const gasDisplay = document.getElementById('scrubberGasDisplay');
  const rateDisplay = document.getElementById('scrubberRateDisplay');
  const phasePill = document.getElementById('scrubberPhasePill');
  const recoDisplay = document.getElementById('scrubberRecoDisplay');
  const flaskLiquid = document.getElementById('flaskLiquid');

  if (!slider) return;

  function updateScrubber(tHr) {
    if (timeDisplay) {
      const totalMins = Math.round(tHr * 60);
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      timeDisplay.innerText = `${tHr.toFixed(1)} h (${h}h ${m}m)`;
    }

    // Sigmoidal Kinetic Parameters
    const K = 795.0;   // Carrying capacity (NTU)
    const N0 = 105.0;  // Inoculum baseline (NTU)
    const r = 0.85;    // Specific growth coefficient
    const t0 = 4.2;    // Inflection midpoint (hours)

    // 1. Optical Turbidity & Analytic Slope dN/dt
    const expTerm = Math.exp(-r * (tHr - t0));
    let turbidity = N0 + (K - N0) / (1.0 + expTerm);
    let dNdt = ((K - N0) * r * expTerm) / Math.pow(1.0 + expTerm, 2);

    if (tHr > 9.5) {
      turbidity -= (tHr - 9.5) * 35.0;
      dNdt = -35.0;
    }
    turbidity = Math.max(N0, Math.round(turbidity * 10) / 10);
    dNdt = Math.round(dNdt * 10) / 10;

    // 2. Exothermic Thermal Shift
    const tempBoost = tHr < 8.0 ? 0.4 * (1.0 / (1.0 + expTerm)) : 0.0;
    const temp = Math.round((31.2 + tempBoost) * 10) / 10;

    // 3. Broth Acidification (pH 7.10 -> 5.45)
    const growthFrac = Math.min(1.0, Math.max(0.0, (turbidity - N0) / (K - N0)));
    const ph = Math.round((7.10 - (1.65 * growthFrac)) * 100) / 100;

    // 4. Headspace CO2 Evolution (PPM)
    let gas = 420.0 + (2480.0 * growthFrac);
    if (tHr > 9.5) {
      gas -= (tHr - 9.5) * 200.0;
    }
    gas = Math.round(Math.max(400.0, gas));

    // Update Telemetry Readouts
    if (turbDisplay) turbDisplay.innerText = `${turbidity.toFixed(1)} NTU`;
    if (tempDisplay) tempDisplay.innerText = `${temp.toFixed(1)} °C`;
    if (phDisplay) phDisplay.innerText = `${ph.toFixed(2)}`;
    if (gasDisplay) gasDisplay.innerText = `${gas} PPM`;
    if (rateDisplay) rateDisplay.innerText = `${dNdt >= 0 ? '+' : ''}${dNdt.toFixed(1)} NTU/hr`;

    // Determine Growth Phase & Advisory
    let phaseText = '';
    let phaseClass = '';
    let recoText = '';

    if (tHr < 2.0) {
      phaseText = 'PHASE I · LAG (ADAPTATION)';
      phaseClass = 'badge-lag';
      recoText = 'Cells synthesizing metabolic enzymes for nutrient uptake. Division rate near zero; maintain thermal stability.';
      if (flaskLiquid) {
        flaskLiquid.style.background = 'linear-gradient(180deg, rgba(59, 130, 246, 0.22) 0%, rgba(30, 64, 175, 0.42) 100%)';
        flaskLiquid.style.filter = 'blur(0px)';
      }
    } else if (tHr < 7.5) {
      phaseText = 'PHASE II · LOG (EXPONENTIAL)';
      phaseClass = 'badge-log';
      recoText = 'Balanced exponential binary fission active. Turbidity and CO2 off-gassing rising rapidly; monitor substrate pH drift.';
      if (flaskLiquid) {
        flaskLiquid.style.background = 'linear-gradient(180deg, rgba(16, 185, 129, 0.38) 0%, rgba(5, 150, 105, 0.68) 100%)';
        flaskLiquid.style.filter = 'blur(0.7px)';
      }
    } else if (tHr <= 9.3) {
      phaseText = 'PHASE III · STATIONARY (PEAK)';
      phaseClass = 'badge-stationary';
      recoText = 'HARVEST WINDOW REACHED: Biomass saturated near carrying capacity (K) and dN/dt approaches 0. Collect batch sample now for peak yield.';
      if (flaskLiquid) {
        flaskLiquid.style.background = 'linear-gradient(180deg, rgba(245, 158, 11, 0.5) 0%, rgba(180, 83, 9, 0.82) 100%)';
        flaskLiquid.style.filter = 'blur(1.5px)';
      }
    } else {
      phaseText = 'PHASE IV · DECLINE / LYSIS';
      phaseClass = 'badge-death';
      recoText = 'Carbon depletion and organic acid toxicity triggering cell autolysis. Terminate reactor immediately to preserve product integrity.';
      if (flaskLiquid) {
        flaskLiquid.style.background = 'linear-gradient(180deg, rgba(239, 68, 68, 0.45) 0%, rgba(153, 27, 27, 0.8) 100%)';
        flaskLiquid.style.filter = 'blur(1.2px)';
      }
    }

    if (phasePill) {
      phasePill.innerText = phaseText;
      phasePill.className = `px-3 py-1 rounded text-[11px] font-semibold uppercase tracking-wider mono-font ${phaseClass}`;
    }
    if (recoDisplay) {
      recoDisplay.innerText = recoText;
    }
  }

  slider.addEventListener('input', (e) => {
    updateScrubber(parseFloat(e.target.value));
  });

  updateScrubber(4.5);
}

// -------------------------------------------------------------
// 2. SCROLLYTELLING WITH INTERACTIVE SIGMOID SVG REGION HIGHLIGHT
// -------------------------------------------------------------
function initScrollytelling() {
  const steps = document.querySelectorAll('.step-card');
  if (!steps || steps.length === 0) return;

  function highlightPhaseSvg(stepNum) {
    const phaseMeta = {
      '1': { label: 'Phase I: Lag Adaptation', color: '#3b82f6', cx: 52, cy: 132 },
      '2': { label: 'Phase II: Exponential Velocity', color: '#10b981', cx: 148, cy: 84 },
      '3': { label: 'Phase III: Stationary Plateau', color: '#f59e0b', cx: 245, cy: 32 },
      '4': { label: 'Phase IV: Cell Autolysis', color: '#ef4444', cx: 325, cy: 56 }
    }[stepNum];

    const dot = document.getElementById('svgPhaseMarker');
    const halo = document.getElementById('svgPhaseHalo');
    const tag = document.getElementById('svgActivePhaseTag');

    if (phaseMeta && dot && halo) {
      dot.setAttribute('cx', phaseMeta.cx);
      dot.setAttribute('cy', phaseMeta.cy);
      dot.setAttribute('fill', phaseMeta.color);
      halo.setAttribute('cx', phaseMeta.cx);
      halo.setAttribute('cy', phaseMeta.cy);
      halo.setAttribute('stroke', phaseMeta.color);
    }
    if (phaseMeta && tag) {
      tag.innerText = phaseMeta.label;
      tag.style.color = phaseMeta.color;
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          steps.forEach((s) => s.classList.remove('active-step'));
          entry.target.classList.add('active-step');
          highlightPhaseSvg(entry.target.dataset.step);
        }
      });
    },
    { threshold: 0.55 }
  );

  steps.forEach((step) => {
    observer.observe(step);
    step.addEventListener('click', () => {
      steps.forEach((s) => s.classList.remove('active-step'));
      step.classList.add('active-step');
      highlightPhaseSvg(step.dataset.step);
    });
  });
}

// -------------------------------------------------------------
// 3. SMOOTH SCROLL FOR IN-PAGE ANCHORS
// -------------------------------------------------------------
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const el = document.querySelector(targetId);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });
}

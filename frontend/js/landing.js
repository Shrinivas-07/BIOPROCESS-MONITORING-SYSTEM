/**
 * Bioprocess Landing Page Controller
 * Powers interactive culture scrubber, scrollytelling steps, and micro-interactions
 */

document.addEventListener('DOMContentLoaded', () => {
  initCultureScrubber();
  initScrollytelling();
  initSmoothScroll();
});

// -------------------------------------------------------------
// 1. INTERACTIVE BIOPROCESS SCRUBBER SANDBOX
// -------------------------------------------------------------
function initCultureScrubber() {
  const slider = document.getElementById('scrubberSlider');
  const timeDisplay = document.getElementById('scrubberTimeDisplay');
  const turbDisplay = document.getElementById('scrubberTurbDisplay');
  const tempDisplay = document.getElementById('scrubberTempDisplay');
  const phDisplay = document.getElementById('scrubberPhDisplay');
  const gasDisplay = document.getElementById('scrubberGasDisplay');
  const phasePill = document.getElementById('scrubberPhasePill');
  const recoDisplay = document.getElementById('scrubberRecoDisplay');
  const flaskLiquid = document.getElementById('flaskLiquid');

  if (!slider) return;

  function updateScrubber(tHr) {
    if (timeDisplay) timeDisplay.innerText = `${tHr.toFixed(1)} Hours`;

    // Biological growth math (Sigmoidal parameters)
    const K = 795.0;   // Carrying capacity
    const N0 = 105.0;  // Baseline turbidity
    const r = 0.85;    // Growth rate
    const t0 = 4.2;    // Inflection point (hours)

    // 1. Turbidity
    let turbidity = N0 + (K - N0) / (1.0 + Math.exp(-r * (tHr - t0)));
    if (tHr > 9.5) {
      turbidity -= (tHr - 9.5) * 35.0; // Decline in death phase
    }
    turbidity = Math.max(N0, Math.round(turbidity * 10) / 10);

    // 2. Temperature
    const tempBoost = tHr < 8.0 ? 0.4 * (1.0 / (1.0 + Math.exp(-r * (tHr - t0)))) : 0.0;
    const temp = Math.round((30.1 + tempBoost) * 10) / 10;

    // 3. pH (Drops from 7.10 down to 5.45)
    const growthFrac = Math.min(1.0, Math.max(0.0, (turbidity - N0) / (K - N0)));
    const ph = Math.round((7.10 - (1.65 * growthFrac)) * 100) / 100;

    // 4. Headspace Gas (Surges from 420 to 2900 PPM)
    let gas = 420.0 + (2500.0 * growthFrac);
    if (tHr > 9.5) {
      gas -= (tHr - 9.5) * 200.0;
    }
    gas = Math.round(Math.max(400.0, gas));

    // Update displays
    if (turbDisplay) turbDisplay.innerText = `${turbidity.toFixed(1)} NTU`;
    if (tempDisplay) tempDisplay.innerText = `${temp.toFixed(1)} °C`;
    if (phDisplay) phDisplay.innerText = `${ph.toFixed(2)}`;
    if (gasDisplay) gasDisplay.innerText = `${gas} PPM`;

    // 5. Phase determination & UI styling
    let phaseText = '';
    let phaseClass = '';
    let recoText = '';

    if (tHr < 2.0) {
      phaseText = 'LAG PHASE';
      phaseClass = 'badge-lag';
      recoText = 'Microorganisms adjusting to nutrient medium. Cell division minimal; enzyme induction in progress.';
      if (flaskLiquid) {
        flaskLiquid.style.background = 'linear-gradient(180deg, rgba(234, 179, 8, 0.25) 0%, rgba(202, 138, 4, 0.45) 100%)';
        flaskLiquid.style.filter = 'blur(0px)';
      }
    } else if (tHr < 7.5) {
      phaseText = 'LOG (EXPONENTIAL)';
      phaseClass = 'badge-log';
      recoText = 'Rapid binary fission active. Turbidity & CO₂ production soaring. Maintain aeration and incubation temperature.';
      if (flaskLiquid) {
        flaskLiquid.style.background = 'linear-gradient(180deg, rgba(16, 185, 129, 0.4) 0%, rgba(13, 148, 136, 0.7) 100%)';
        flaskLiquid.style.filter = 'blur(1px)';
      }
    } else if (tHr <= 9.3) {
      phaseText = 'STATIONARY (PEAK)';
      phaseClass = 'badge-stationary';
      recoText = '⚠️ OPTIMAL HARVEST WINDOW! Maximum biomass carrying capacity reached. First derivative dN/dt → 0. Harvest now!';
      if (flaskLiquid) {
        flaskLiquid.style.background = 'linear-gradient(180deg, rgba(245, 158, 11, 0.6) 0%, rgba(217, 119, 6, 0.85) 100%)';
        flaskLiquid.style.filter = 'blur(2px)';
      }
    } else {
      phaseText = 'DEATH / DECLINE';
      phaseClass = 'badge-death';
      recoText = 'Substrates depleted. Toxic metabolite accumulation causes cell lysis. Harvest immediately or dump batch.';
      if (flaskLiquid) {
        flaskLiquid.style.background = 'linear-gradient(180deg, rgba(239, 68, 68, 0.5) 0%, rgba(185, 28, 28, 0.8) 100%)';
        flaskLiquid.style.filter = 'blur(1.5px)';
      }
    }

    if (phasePill) {
      phasePill.innerText = phaseText;
      phasePill.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${phaseClass}`;
    }
    if (recoDisplay) {
      recoDisplay.innerText = recoText;
    }
  }

  slider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    updateScrubber(val);
  });

  // Initial trigger at 4.5 hours (mid log)
  updateScrubber(4.5);
}

// -------------------------------------------------------------
// 2. SCROLLYTELLING INTERSECTION OBSERVER
// -------------------------------------------------------------
function initScrollytelling() {
  const steps = document.querySelectorAll('.step-card');
  if (!steps || steps.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          steps.forEach((s) => s.classList.remove('active-step'));
          entry.target.classList.add('active-step');
        }
      });
    },
    { threshold: 0.6 }
  );

  steps.forEach((step) => observer.observe(step));
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


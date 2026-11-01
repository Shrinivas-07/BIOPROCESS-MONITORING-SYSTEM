/**
 * Bioprocess Charts Manager (Chart.js 4.x)
 * Features:
 *  - Stock Market Timeline Resolution Selector (1m, 5m, 15m, 20m, 30m, 1h, All)
 *  - Horizontal Chart Panning & Scrubbing
 *  - 12-Hour Format (AM/PM) + Hours & Minutes Elapsed Visuals
 *  - Synchronized Tooltips for Turbidity, Temp, pH, and Off-Gas
 */

let growthChart = null;
let derivativeChart = null;
let envChart = null;

let cachedHistoryData = [];
let cachedPredictionData = null;
let cachedBatchMeta = null;
let activeResolution = 'all';

const ChartsManager = {
  initCharts() {
    this.initGrowthChart();
    this.initDerivativeChart();
    this.initEnvChart();
    this.setupTimelineControls();
  },

  // -------------------------------------------------------------
  // STOCK MARKET TIMELINE & HORIZONTAL SCROLL CONTROLS
  // -------------------------------------------------------------
  setupTimelineControls() {
    // Resolution selector buttons (1m, 5m, 15m, 20m, 30m, 1h, All)
    const btnContainer = document.getElementById('chartTimelineButtons');
    if (btnContainer) {
      btnContainer.querySelectorAll('.timeline-res-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          btnContainer.querySelectorAll('.timeline-res-btn').forEach(b => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
          activeResolution = e.currentTarget.dataset.resolution || 'all';
          this.applyResolutionAndReRender();
        });
      });
    }

    // Horizontal Scroll Buttons
    const leftBtn = document.getElementById('chartScrollLeftBtn');
    const rightBtn = document.getElementById('chartScrollRightBtn');
    const resetBtn = document.getElementById('chartScrollResetBtn');
    const gWrapper = document.getElementById('growthChartScrollWrapper');
    const eWrapper = document.getElementById('envChartScrollWrapper');

    if (leftBtn) {
      leftBtn.addEventListener('click', () => {
        if (gWrapper) gWrapper.scrollBy({ left: -350, behavior: 'smooth' });
        if (eWrapper) eWrapper.scrollBy({ left: -350, behavior: 'smooth' });
      });
    }

    if (rightBtn) {
      rightBtn.addEventListener('click', () => {
        if (gWrapper) gWrapper.scrollBy({ left: 350, behavior: 'smooth' });
        if (eWrapper) eWrapper.scrollBy({ left: 350, behavior: 'smooth' });
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (gWrapper) gWrapper.scrollTo({ left: gWrapper.scrollWidth, behavior: 'smooth' });
        if (eWrapper) eWrapper.scrollTo({ left: eWrapper.scrollWidth, behavior: 'smooth' });
      });
    }
  },

  // Downsample or bin readings according to chosen timeline resolution
  filterDataByResolution(data, resolution) {
    if (!data || data.length <= 2 || resolution === 'all') {
      return data;
    }

    const intervalMinutes = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '20m': 20,
      '30m': 30,
      '1h': 60
    }[resolution];

    if (!intervalMinutes) return data;

    const intervalMs = intervalMinutes * 60 * 1000;
    const filtered = [data[0]];
    let lastTime = new Date(data[0].created_at).getTime();

    for (let i = 1; i < data.length - 1; i++) {
      const curTime = new Date(data[i].created_at).getTime();
      if (curTime - lastTime >= intervalMs) {
        filtered.push(data[i]);
        lastTime = curTime;
      }
    }

    // Always include the latest point
    filtered.push(data[data.length - 1]);
    return filtered;
  },

  applyResolutionAndReRender() {
    if (!cachedHistoryData || cachedHistoryData.length === 0) return;
    const filtered = this.filterDataByResolution(cachedHistoryData, activeResolution);
    this.renderChartsData(filtered, cachedPredictionData, cachedBatchMeta);
  },

  // -------------------------------------------------------------
  // 1. PRIMARY GROWTH CURVE (TURBIDITY & PREDICTED SIGMOID)
  // -------------------------------------------------------------
  initGrowthChart() {
    const ctx = document.getElementById('growthChartCanvas');
    if (!ctx) return;

    growthChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Measured Turbidity (OD/NTU)',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.3,
            pointRadius: 3.5,
            pointHoverRadius: 6,
            pointBackgroundColor: '#10b981'
          },
          {
            label: 'Projected Model Curve (Logistic)',
            data: [],
            borderColor: '#06b6d4',
            borderWidth: 2,
            borderDash: [6, 4],
            fill: false,
            tension: 0.35,
            pointRadius: 2,
            pointBackgroundColor: '#06b6d4'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 12 } }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            titleColor: '#38bdf8',
            bodyColor: '#e5e7eb',
            borderColor: 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              title: (items) => {
                if (!items || !items[0]) return '';
                const idx = items[0].dataIndex;
                const pt = items[0].chart._filteredPoints?.[idx];
                if (pt && pt.created_at) {
                  const d = new Date(pt.created_at);
                  const time12 = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
                  const base = new Date(items[0].chart._baseTime).getTime();
                  const diffMin = Math.max(0, Math.round((d.getTime() - base) / 60000));
                  const h = Math.floor(diffMin / 60);
                  const m = diffMin % 60;
                  const dur = h > 0 ? `${h}h ${m}m` : `${m} min`;
                  return `🕒 ${time12} (Runtime: ${dur})`;
                }
                return items[0].label;
              },
              label: (item) => {
                const val = typeof item.parsed.y === 'number' ? item.parsed.y.toFixed(1) : item.parsed.y;
                return ` ${item.dataset.label}: ${val} NTU`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#9ca3af',
              font: { size: 11, family: 'JetBrains Mono' },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12
            },
            title: { display: true, text: 'Reaction Time (12-Hour IST / Elapsed)', color: '#9ca3af' }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#9ca3af' },
            title: { display: true, text: 'Turbidity (NTU)', color: '#9ca3af' },
            suggestedMin: 80,
            suggestedMax: 850
          }
        }
      }
    });
  },

  // -------------------------------------------------------------
  // 2. FIRST DERIVATIVE CHART: GROWTH RATE (dN/dt)
  // -------------------------------------------------------------
  initDerivativeChart() {
    const ctx = document.getElementById('derivativeChartCanvas');
    if (!ctx) return;

    derivativeChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Growth Rate (Δ Turbidity / Δ t)',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2.5,
            pointBackgroundColor: '#f59e0b'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 12 } }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            callbacks: {
              label: (item) => ` Speed: ${item.parsed.y.toFixed(1)} NTU/hr`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#9ca3af', maxTicksLimit: 6 },
            title: { display: true, text: 'Time', color: '#9ca3af' }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#9ca3af' },
            title: { display: true, text: 'Rate (NTU / hr)', color: '#9ca3af' }
          }
        }
      }
    });
  },

  // -------------------------------------------------------------
  // 3. ENVIRONMENTAL & OFF-GAS CHART
  // -------------------------------------------------------------
  initEnvChart() {
    const ctx = document.getElementById('envChartCanvas');
    if (!ctx) return;

    envChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Temperature (°C)',
            data: [],
            borderColor: '#f97316',
            borderWidth: 2,
            yAxisID: 'yTemp',
            tension: 0.25,
            pointRadius: 2.5
          },
          {
            label: 'pH Level',
            data: [],
            borderColor: '#8b5cf6',
            borderWidth: 2,
            yAxisID: 'yPH',
            tension: 0.25,
            pointRadius: 2.5
          },
          {
            label: 'Off-Gas / CO₂ (PPM)',
            data: [],
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.06)',
            borderWidth: 2,
            borderDash: [4, 3],
            yAxisID: 'yGas',
            tension: 0.25,
            pointRadius: 2.5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 12 } }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            titleColor: '#38bdf8',
            borderColor: 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              title: (items) => {
                if (!items || !items[0]) return '';
                const idx = items[0].dataIndex;
                const pt = items[0].chart._filteredPoints?.[idx];
                if (pt && pt.created_at) {
                  const d = new Date(pt.created_at);
                  const time12 = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
                  const base = new Date(items[0].chart._baseTime).getTime();
                  const diffMin = Math.max(0, Math.round((d.getTime() - base) / 60000));
                  const h = Math.floor(diffMin / 60);
                  const m = diffMin % 60;
                  const dur = h > 0 ? `${h}h ${m}m` : `${m} min`;
                  return `🕒 ${time12} (Runtime: ${dur})`;
                }
                return items[0].label;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#9ca3af',
              font: { size: 11, family: 'JetBrains Mono' },
              maxTicksLimit: 12
            }
          },
          yTemp: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#f97316' },
            title: { display: true, text: 'Temp (°C)', color: '#f97316' },
            suggestedMin: 25,
            suggestedMax: 38
          },
          yPH: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#8b5cf6' },
            title: { display: true, text: 'pH', color: '#8b5cf6' },
            suggestedMin: 4.5,
            suggestedMax: 7.5
          },
          yGas: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#06b6d4' },
            title: { display: true, text: 'Gas (PPM)', color: '#06b6d4' },
            suggestedMin: 350,
            suggestedMax: 3200
          }
        }
      }
    });
  },

  // -------------------------------------------------------------
  // UPDATE ALL CHARTS WITH FRESH DATA
  // -------------------------------------------------------------
  updateCharts(historyData, predictionData, batchMeta = null) {
    if (!historyData || historyData.length === 0) return;

    cachedHistoryData = historyData;
    cachedPredictionData = predictionData;
    cachedBatchMeta = batchMeta;

    const filtered = this.filterDataByResolution(historyData, activeResolution);
    this.renderChartsData(filtered, predictionData, batchMeta);
  },

  renderChartsData(filteredData, predictionData, batchMeta = null) {
    if (!filteredData || filteredData.length === 0) return;

    const firstPt = filteredData[0];
    const lastPt = filteredData[filteredData.length - 1];

    const baseTime = new Date(batchMeta?.started_at || firstPt.created_at).getTime();
    const endTime = batchMeta?.stopped_at ? new Date(batchMeta.stopped_at).getTime() : new Date(lastPt.created_at).getTime();

    // 1. Update the Chart Timeline Visual Header (Start, End, Total Runtime)
    const startTimeEl = document.getElementById('chartStartTimeDisplay');
    const endTimeEl = document.getElementById('chartEndTimeDisplay');
    const durationEl = document.getElementById('chartDurationDisplay');
    const endLabelEl = document.getElementById('chartEndLabel');

    const startDate = new Date(baseTime);
    const endDate = new Date(endTime);

    if (startTimeEl) {
      startTimeEl.innerText = startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    if (endTimeEl) {
      endTimeEl.innerText = endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    if (endLabelEl) {
      endLabelEl.innerText = batchMeta?.status === 'completed' ? '⏹ Stopped:' : '● Latest:';
    }

    // Format total runtime in both hours and minutes
    const totalRuntimeMinutes = Math.max(0, Math.round((endTime - baseTime) / 60000));
    const runH = Math.floor(totalRuntimeMinutes / 60);
    const runM = totalRuntimeMinutes % 60;
    const formattedRuntime = runH > 0 ? `${runH}h ${runM}m` : `${runM}m`;

    if (durationEl) {
      durationEl.innerText = formattedRuntime;
    }

    // 2. Adjust Canvas Width Dynamically for Smooth Horizontal Movement
    // For high point density or 1m resolution, expand the canvas horizontally
    const minWidth = Math.max(100, Math.min(2800, filteredData.length * 28));
    const growthInner = document.getElementById('growthChartInnerCanvas');
    const envInner = document.getElementById('envChartInnerCanvas');

    if (growthInner) {
      growthInner.style.minWidth = filteredData.length > 15 ? `${minWidth}px` : '100%';
    }
    if (envInner) {
      envInner.style.minWidth = filteredData.length > 15 ? `${minWidth}px` : '100%';
    }

    // 3. Generate 12-Hour AM/PM Labels with Elapsed Runtime (Hours & Minutes)
    const labels = filteredData.map(item => {
      const d = new Date(item.created_at);
      const time12 = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      const elapsedMin = Math.max(0, Math.round((d.getTime() - baseTime) / 60000));
      const h = Math.floor(elapsedMin / 60);
      const m = elapsedMin % 60;
      const elapsed = h > 0 ? `${h}h ${m}m` : `${m}m`;
      return `${time12} (${elapsed})`;
    });

    const turbValues = filteredData.map(item => item.turbidity);
    const tempValues = filteredData.map(item => item.temperature);
    const phValues = filteredData.map(item => item.ph);
    const gasValues = filteredData.map(item => item.gas || 400.0);

    // 4. Update Growth Chart
    if (growthChart) {
      growthChart._filteredPoints = filteredData;
      growthChart._baseTime = baseTime;
      growthChart.data.labels = [...labels];
      growthChart.data.datasets[0].data = [...turbValues];

      // Append predictive projection
      if (predictionData && predictionData.predicted_projection && predictionData.predicted_projection.length > 0) {
        const proj = predictionData.predicted_projection;
        const lastDate = new Date(lastPt.created_at);

        const projLabels = proj.map(p => {
          const futureDate = new Date(baseTime + p.time_hr * 3600000);
          const t12 = futureDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
          const mTotal = Math.round(p.time_hr * 60);
          const h = Math.floor(mTotal / 60);
          const m = mTotal % 60;
          return `${t12} (${h}h ${m}m proj)`;
        });

        const projData = new Array(labels.length - 1).fill(null);
        projData.push(turbValues[turbValues.length - 1]);
        proj.forEach(p => projData.push(p.predicted_turbidity));

        const allLabels = [...labels, ...projLabels.slice(1)];
        growthChart.data.labels = allLabels;
        growthChart.data.datasets[1].data = projData;
      } else {
        growthChart.data.datasets[1].data = [];
      }

      growthChart.update('none');
    }

    // 5. Update Derivative Chart
    if (derivativeChart && predictionData && predictionData.growth_rate_series) {
      const dSeries = predictionData.growth_rate_series;
      derivativeChart.data.labels = dSeries.map(s => {
        const d = new Date(baseTime + s.time_hr * 3600000);
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      });
      derivativeChart.data.datasets[0].data = dSeries.map(s => s.growth_rate_dndt);
      derivativeChart.update('none');
    }

    // 6. Update Environmental Chart
    if (envChart) {
      envChart._filteredPoints = filteredData;
      envChart._baseTime = baseTime;
      envChart.data.labels = labels;
      envChart.data.datasets[0].data = tempValues;
      envChart.data.datasets[1].data = phValues;
      if (envChart.data.datasets[2]) {
        envChart.data.datasets[2].data = gasValues;
      }
      envChart.update('none');
    }
  }
};

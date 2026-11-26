/**
 * Bioprocess Charts Manager (Chart.js 4.x)
 * Precision SCADA Telemetry Charts:
 *  - Stock-Market Style Resolution Filtering (1m, 5m, 15m, 20m, 30m, 1h, All)
 *  - Horizontal Timeline Panning & Scrubbing
 *  - 12-Hour Clock (AM/PM) + Elapsed Duration (Hours & Minutes)
 */

let growthChart = null;
let derivativeChart = null;
let envChart = null;

let cachedHistoryData = [];
let cachedPredictionData = null;
let cachedBatchMeta = null;
let activeResolution = 'all';

const CHART_FONT_UI = 'Inter, -apple-system, sans-serif';
const CHART_FONT_MONO = 'JetBrains Mono, monospace';
const GRID_COLOR = 'rgba(148, 163, 184, 0.07)';
const TICK_COLOR = '#64748b';

const ChartsManager = {
  initCharts() {
    this.initGrowthChart();
    this.initDerivativeChart();
    this.initEnvChart();
    this.setupTimelineControls();
  },

  setupTimelineControls() {
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

    const leftBtn = document.getElementById('chartScrollLeftBtn');
    const rightBtn = document.getElementById('chartScrollRightBtn');
    const resetBtn = document.getElementById('chartScrollResetBtn');
    const gWrapper = document.getElementById('growthChartScrollWrapper');
    const eWrapper = document.getElementById('envChartScrollWrapper');

    if (leftBtn) {
      leftBtn.addEventListener('click', () => {
        if (gWrapper) gWrapper.scrollBy({ left: -340, behavior: 'smooth' });
        if (eWrapper) eWrapper.scrollBy({ left: -340, behavior: 'smooth' });
      });
    }

    if (rightBtn) {
      rightBtn.addEventListener('click', () => {
        if (gWrapper) gWrapper.scrollBy({ left: 340, behavior: 'smooth' });
        if (eWrapper) eWrapper.scrollBy({ left: 340, behavior: 'smooth' });
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (gWrapper) gWrapper.scrollTo({ left: gWrapper.scrollWidth, behavior: 'smooth' });
        if (eWrapper) eWrapper.scrollTo({ left: eWrapper.scrollWidth, behavior: 'smooth' });
      });
    }
  },

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

    filtered.push(data[data.length - 1]);
    return filtered;
  },

  applyResolutionAndReRender() {
    if (!cachedHistoryData || cachedHistoryData.length === 0) return;
    const filtered = this.filterDataByResolution(cachedHistoryData, activeResolution);
    this.renderChartsData(filtered, cachedPredictionData, cachedBatchMeta);
  },

  initGrowthChart() {
    const ctx = document.getElementById('growthChartCanvas');
    if (!ctx) return;

    growthChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Measured Turbidity (NTU)',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.10)',
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#10b981'
          },
          {
            label: 'Logistic Projection (NTU)',
            data: [],
            borderColor: '#0ea5e9',
            borderWidth: 1.75,
            borderDash: [5, 4],
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointBackgroundColor: '#0ea5e9'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: '#0f141b',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            titleFont: { family: CHART_FONT_MONO, size: 11 },
            bodyFont: { family: CHART_FONT_MONO, size: 11 },
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
                  return `${time12}  ·  Elapsed ${dur}`;
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
            grid: { color: GRID_COLOR },
            ticks: {
              color: TICK_COLOR,
              font: { size: 10, family: CHART_FONT_MONO },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10
            },
            title: {
              display: true,
              text: 'Time (12-Hour Clock / Elapsed Runtime)',
              color: '#64748b',
              font: { size: 10, family: CHART_FONT_UI }
            }
          },
          y: {
            grid: { color: GRID_COLOR },
            ticks: { color: TICK_COLOR, font: { size: 10, family: CHART_FONT_MONO } },
            title: {
              display: true,
              text: 'Turbidity (NTU)',
              color: '#64748b',
              font: { size: 10, family: CHART_FONT_UI }
            },
            suggestedMin: 80,
            suggestedMax: 850
          }
        }
      }
    });
  },

  initDerivativeChart() {
    const ctx = document.getElementById('derivativeChartCanvas');
    if (!ctx) return;

    derivativeChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'dN/dt (NTU/hr)',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.10)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointBackgroundColor: '#f59e0b'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: '#0f141b',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: '#334155',
            borderWidth: 1,
            titleFont: { family: CHART_FONT_MONO, size: 11 },
            bodyFont: { family: CHART_FONT_MONO, size: 11 },
            callbacks: {
              label: (item) => ` Velocity: ${item.parsed.y.toFixed(1)} NTU/hr`
            }
          }
        },
        scales: {
          x: {
            grid: { color: GRID_COLOR },
            ticks: { color: TICK_COLOR, font: { size: 10, family: CHART_FONT_MONO }, maxTicksLimit: 6 }
          },
          y: {
            grid: { color: GRID_COLOR },
            ticks: { color: TICK_COLOR, font: { size: 10, family: CHART_FONT_MONO } },
            title: {
              display: true,
              text: 'Rate (NTU/hr)',
              color: '#64748b',
              font: { size: 10, family: CHART_FONT_UI }
            }
          }
        }
      }
    });
  },

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
            borderColor: '#fb923c',
            borderWidth: 1.75,
            yAxisID: 'yTemp',
            tension: 0.25,
            pointRadius: 2
          },
          {
            label: 'pH Level',
            data: [],
            borderColor: '#a78bfa',
            borderWidth: 1.75,
            yAxisID: 'yPH',
            tension: 0.25,
            pointRadius: 2
          },
          {
            label: 'Off-Gas CO2 (PPM)',
            data: [],
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34, 211, 238, 0.04)',
            borderWidth: 1.75,
            borderDash: [4, 3],
            yAxisID: 'yGas',
            tension: 0.25,
            pointRadius: 2
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
            align: 'end',
            labels: {
              color: '#94a3b8',
              boxWidth: 12,
              boxHeight: 2,
              font: { family: CHART_FONT_MONO, size: 10 }
            }
          },
          tooltip: {
            backgroundColor: '#0f141b',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            titleFont: { family: CHART_FONT_MONO, size: 11 },
            bodyFont: { family: CHART_FONT_MONO, size: 11 },
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
                  return `${time12}  ·  Elapsed ${dur}`;
                }
                return items[0].label;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: GRID_COLOR },
            ticks: {
              color: TICK_COLOR,
              font: { size: 10, family: CHART_FONT_MONO },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12
            }
          },
          yTemp: {
            type: 'linear',
            position: 'left',
            grid: { color: GRID_COLOR },
            ticks: { color: '#fb923c', font: { size: 10, family: CHART_FONT_MONO } },
            title: { display: true, text: 'Temp (°C)', color: '#fb923c', font: { size: 10 } },
            suggestedMin: 25,
            suggestedMax: 38
          },
          yPH: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#a78bfa', font: { size: 10, family: CHART_FONT_MONO } },
            title: { display: true, text: 'pH', color: '#a78bfa', font: { size: 10 } },
            suggestedMin: 4.5,
            suggestedMax: 7.5
          },
          yGas: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#22d3ee', font: { size: 10, family: CHART_FONT_MONO } },
            title: { display: true, text: 'CO2 (PPM)', color: '#22d3ee', font: { size: 10 } },
            suggestedMin: 350,
            suggestedMax: 3200
          }
        }
      }
    });
  },

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
      endLabelEl.innerText = batchMeta?.status === 'completed' ? 'Stopped:' : 'Latest:';
    }

    const totalRuntimeMinutes = Math.max(0, Math.round((endTime - baseTime) / 60000));
    const runH = Math.floor(totalRuntimeMinutes / 60);
    const runM = totalRuntimeMinutes % 60;
    const formattedRuntime = runH > 0 ? `${runH}h ${runM}m` : `${runM} min`;

    if (durationEl) {
      durationEl.innerText = formattedRuntime;
    }

    const minWidth = Math.max(100, Math.min(2800, filteredData.length * 28));
    const growthInner = document.getElementById('growthChartInnerCanvas');
    const envInner = document.getElementById('envChartInnerCanvas');

    if (growthInner) {
      growthInner.style.minWidth = filteredData.length > 15 ? `${minWidth}px` : '100%';
    }
    if (envInner) {
      envInner.style.minWidth = filteredData.length > 15 ? `${minWidth}px` : '100%';
    }

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

    if (growthChart) {
      growthChart._filteredPoints = filteredData;
      growthChart._baseTime = baseTime;
      growthChart.data.labels = [...labels];
      growthChart.data.datasets[0].data = [...turbValues];

      if (predictionData && predictionData.predicted_projection && predictionData.predicted_projection.length > 0) {
        const proj = predictionData.predicted_projection;
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

        growthChart.data.labels = [...labels, ...projLabels.slice(1)];
        growthChart.data.datasets[1].data = projData;
      } else {
        growthChart.data.datasets[1].data = [];
      }

      growthChart.update('none');
    }

    if (derivativeChart && predictionData && predictionData.growth_rate_series) {
      const dSeries = predictionData.growth_rate_series;
      derivativeChart.data.labels = dSeries.map(s => {
        const d = new Date(baseTime + s.time_hr * 3600000);
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      });
      derivativeChart.data.datasets[0].data = dSeries.map(s => s.growth_rate_dndt);
      derivativeChart.update('none');
    }

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

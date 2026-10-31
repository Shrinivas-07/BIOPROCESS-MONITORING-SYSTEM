/**
 * Bioprocess Charts Manager (Chart.js 4.x)
 */

let growthChart = null;
let derivativeChart = null;
let envChart = null;

const ChartsManager = {
  initCharts() {
    this.initGrowthChart();
    this.initDerivativeChart();
    this.initEnvChart();
  },

  // 1. Primary Growth Curve Chart (Turbidity & Predictive Sigmoid)
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
            pointRadius: 3,
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
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            titleColor: '#f3f4f6',
            bodyColor: '#e5e7eb',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#6b7280', maxTicksLimit: 8 },
            title: { display: true, text: 'Time (Hours Elapsed)', color: '#9ca3af' }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#6b7280' },
            title: { display: true, text: 'Turbidity (NTU)', color: '#9ca3af' },
            suggestedMin: 80,
            suggestedMax: 850
          }
        }
      }
    });
  },

  // 2. First Derivative Chart: Growth Rate (dN/dt)
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
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
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
            labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 12 } }
          },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#6b7280', maxTicksLimit: 8 },
            title: { display: true, text: 'Time (Hours)', color: '#9ca3af' }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#6b7280' },
            title: { display: true, text: 'Rate (NTU / hr)', color: '#9ca3af' }
          }
        }
      }
    });
  },

  // 3. Environmental Parameters (pH & Temperature)
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
            pointRadius: 2
          },
          {
            label: 'pH Level',
            data: [],
            borderColor: '#8b5cf6',
            borderWidth: 2,
            yAxisID: 'yPH',
            tension: 0.25,
            pointRadius: 2
          },
          {
            label: 'Off-Gas / CO₂ (PPM)',
            data: [],
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.05)',
            borderWidth: 2,
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
            labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 12 } }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#6b7280', maxTicksLimit: 8 }
          },
          yTemp: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#f97316' },
            title: { display: true, text: 'Temperature (°C)', color: '#f97316' },
            suggestedMin: 25,
            suggestedMax: 38
          },
          yPH: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#8b5cf6' },
            title: { display: true, text: 'pH Level', color: '#8b5cf6' },
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

  // Update all charts with fresh telemetry & prediction data
  updateCharts(historyData, predictionData) {
    if (!historyData || historyData.length === 0) return;

    const baseTime = new Date(historyData[0].created_at).getTime();

    // Format labels as elapsed hours
    const labels = historyData.map(item => {
      const t = (new Date(item.created_at).getTime() - baseTime) / 3600000;
      return `${t.toFixed(1)}h`;
    });

    const turbValues = historyData.map(item => item.turbidity);
    const tempValues = historyData.map(item => item.temperature);
    const phValues = historyData.map(item => item.ph);
    const gasValues = historyData.map(item => item.gas || 400.0);

    // 1. Update Growth Chart
    if (growthChart) {
      growthChart.data.labels = [...labels];
      growthChart.data.datasets[0].data = [...turbValues];

      // Append predictive projection
      if (predictionData && predictionData.predicted_projection && predictionData.predicted_projection.length > 0) {
        // Pad measured dataset with nulls for future projection points
        const proj = predictionData.predicted_projection;
        const projLabels = proj.map(p => `${p.time_hr.toFixed(1)}h`);
        const projData = new Array(labels.length - 1).fill(null);
        
        // Connect last measured point to first projection point
        projData.push(turbValues[turbValues.length - 1]);
        proj.forEach(p => projData.push(p.predicted_turbidity));

        // Combined labels
        const allLabels = [...labels, ...projLabels.slice(1)];
        growthChart.data.labels = allLabels;
        growthChart.data.datasets[1].data = projData;
      } else {
        growthChart.data.datasets[1].data = [];
      }

      growthChart.update('none');
    }

    // 2. Update Derivative Chart
    if (derivativeChart && predictionData && predictionData.growth_rate_series) {
      const dSeries = predictionData.growth_rate_series;
      derivativeChart.data.labels = dSeries.map(s => `${s.time_hr}h`);
      derivativeChart.data.datasets[0].data = dSeries.map(s => s.growth_rate_dndt);
      derivativeChart.update('none');
    }

    // 3. Update Env Chart
    if (envChart) {
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


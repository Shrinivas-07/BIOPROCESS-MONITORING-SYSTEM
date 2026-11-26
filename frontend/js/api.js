/**
 * Bioprocess API Client
 * Communicates with the Python Flask Backend and Supabase REST Proxy
 * Includes dynamic Render/Cloud backend linking and clean offline preview fallback
 */

const API_BASE = (typeof window !== 'undefined' && window.__API_URL__)
  || (typeof localStorage !== 'undefined' && localStorage.getItem('BIOPROCESS_API_BASE'))
  || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');

const MockData = {
  _cachedHistory: null,

  getPreviewBatch() {
    return {
      id: 'preview-batch-03',
      batch_name: 'S. cerevisiae Batch Run #03 (Preview)',
      scientist_name: 'Bio-Automation Lab',
      organism: 'Saccharomyces cerevisiae',
      broth_type: 'YPD Medium (2% Glucose)',
      started_at: new Date(Date.now() - 4.2 * 3600000).toISOString(),
      status: 'active',
      notes: 'Standby preview stream active. Link backend endpoint to ingest live ESP32 telemetry.'
    };
  },

  getPreviewHistory() {
    if (this._cachedHistory) return this._cachedHistory;

    const points = [];
    const count = 24;
    const startTime = Date.now() - 4.2 * 3600000;
    const stepMs = (4.2 * 3600000) / count;
    for (let i = 0; i <= count; i++) {
      const t = i * (4.2 / count);
      const turb = Number((105 + 660 / (1 + Math.exp(-1.35 * (t - 2.35)))).toFixed(1));
      const temp = Number((31.6 + 0.45 * Math.sin(t * 0.9)).toFixed(1));
      const ph = Number((7.08 - 1.48 / (1 + Math.exp(-1.25 * (t - 2.15)))).toFixed(2));
      const gas = Math.round(415 + 1480 / (1 + Math.exp(-1.45 * (t - 2.45))));
      points.push({
        id: `preview-pt-${i}`,
        created_at: new Date(startTime + i * stepMs).toISOString(),
        device_id: 'ESP32_BIO_01',
        turbidity: turb,
        temperature: temp,
        ph: ph,
        gas: gas,
        time_elapsed_hours: Number(t.toFixed(2))
      });
    }
    this._cachedHistory = points;
    return points;
  },

  getPreviewPrediction() {
    const history = this.getPreviewHistory();
    const latest = history[history.length - 1];
    const startTs = history[0].created_at;
    return {
      current_status: 'Log (Exponential) Phase',
      phase_code: 'log',
      growth_rate_formatted: '+18.4% / hr',
      estimated_peak: '~1.8 Hours Remaining',
      growth_trend: 'Accelerating',
      recommendation: 'Rapid exponential cellular proliferation active. Maintain thermal setpoint (32°C) and continuous aeration; prepare downstream harvest vessels.',
      environmental_alerts: [],
      data_source: 'offline_preview',
      latest_reading: latest,
      metrics: {
        initial_turbidity: history[0].turbidity,
        peak_turbidity: latest.turbidity,
        peak_gas: latest.gas,
        predicted_carrying_capacity_K: 785.0,
        batch_duration_hours: 4.2,
        batch_duration_minutes: 252,
        batch_duration_formatted: '4h 12m',
        total_readings: history.length
      },
      phase_milestones: {
        inoculation_start: { timestamp: startTs, turbidity: history[0].turbidity, ph: history[0].ph },
        log_acceleration: { timestamp: history[6].created_at, time_hr: 1.05, turbidity: history[6].turbidity },
        peak_biomass: null,
        harvest_window: null,
        decline_death: null
      },
      predicted_projection: [
        { time_hr: 4.2, predicted_turbidity: latest.turbidity },
        { time_hr: 4.8, predicted_turbidity: 738.4 },
        { time_hr: 5.4, predicted_turbidity: 762.8 },
        { time_hr: 6.0, predicted_turbidity: 775.1 },
        { time_hr: 6.6, predicted_turbidity: 781.0 }
      ],
      growth_rate_series: [
        { time_hr: 0.5, growth_rate_dndt: 22.4 },
        { time_hr: 1.0, growth_rate_dndt: 58.1 },
        { time_hr: 1.5, growth_rate_dndt: 112.6 },
        { time_hr: 2.0, growth_rate_dndt: 185.0 },
        { time_hr: 2.4, growth_rate_dndt: 222.8 },
        { time_hr: 3.0, growth_rate_dndt: 164.3 },
        { time_hr: 3.6, growth_rate_dndt: 94.5 },
        { time_hr: 4.2, growth_rate_dndt: 46.2 }
      ]
    };
  },

  getPreviewBatches() {
    return [
      {
        id: 'batch-archive-001',
        batch_name: 'S. cerevisiae High-Gravity Fermentation',
        scientist_name: 'Dr. Sarah Lin',
        organism: 'Saccharomyces cerevisiae',
        broth_type: 'YPD + 5% Dextrose',
        started_at: new Date(Date.now() - 28 * 3600000).toISOString(),
        stopped_at: new Date(Date.now() - 20 * 3600000).toISOString(),
        status: 'completed',
        peak_turbidity: 792.4,
        peak_gas: 2894.0,
        harvest_delay_minutes: 0,
        notes: 'Harvested precisely at stationary inflection.'
      },
      {
        id: 'batch-archive-002',
        batch_name: 'Log-Phase Substrate Trial #02',
        scientist_name: 'IDEA Lab Team A',
        organism: 'S. cerevisiae ATCC 9763',
        broth_type: 'Standard YPD Broth',
        started_at: new Date(Date.now() - 50 * 3600000).toISOString(),
        stopped_at: new Date(Date.now() - 45.5 * 3600000).toISOString(),
        status: 'completed',
        peak_turbidity: 618.0,
        peak_gas: 2240.0,
        harvest_delay_minutes: 10,
        notes: 'Baseline calibration trial.'
      }
    ];
  }
};

const Api = {
  isOffline: false,
  apiBase: API_BASE,

  async getStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.isOffline = false;
      return data;
    } catch (err) {
      this.isOffline = true;
      return {
        status: 'offline_preview',
        app_name: 'Bioprocess Monitoring & Prediction',
        supabase: { status: 'unconfigured', message: 'Backend unreachable' },
        is_supabase_configured: false,
        error: err.message
      };
    }
  },

  async getLatestTelemetry(batchId = null) {
    try {
      const url = batchId
        ? `${API_BASE}/api/telemetry/latest?batch_id=${encodeURIComponent(batchId)}`
        : `${API_BASE}/api/telemetry/latest`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      const hist = MockData.getPreviewHistory();
      return { data: hist[hist.length - 1], source: 'offline_preview' };
    }
  },

  async getHistory(limit = 100, batchId = null) {
    try {
      const url = batchId
        ? `${API_BASE}/api/telemetry/history?limit=${limit}&batch_id=${encodeURIComponent(batchId)}`
        : `${API_BASE}/api/telemetry/history?limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      const pts = MockData.getPreviewHistory();
      return { count: pts.length, source: 'offline_preview', data: pts };
    }
  },

  async getPrediction(limit = 100, batchId = null) {
    try {
      const url = batchId
        ? `${API_BASE}/api/analytics/predict?limit=${limit}&batch_id=${encodeURIComponent(batchId)}`
        : `${API_BASE}/api/analytics/predict?limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return MockData.getPreviewPrediction();
    }
  },

  async getBatches(limit = 10) {
    try {
      const res = await fetch(`${API_BASE}/api/batches?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      const batches = MockData.getPreviewBatches();
      return { count: batches.length, data: batches };
    }
  },

  async getActiveBatch() {
    try {
      const res = await fetch(`${API_BASE}/api/batches/active`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return { active: true, data: MockData.getPreviewBatch() };
    }
  },

  async startBatch(batchData) {
    try {
      const res = await fetch(`${API_BASE}/api/batches/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchData)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return { error: 'Backend server unreachable. Connect your backend endpoint first.' };
    }
  },

  async stopBatch(payload = {}) {
    try {
      const res = await fetch(`${API_BASE}/api/batches/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return { error: 'Backend server unreachable. Connect your backend endpoint first.' };
    }
  },

  async getBatchDetails(batchId) {
    try {
      const res = await fetch(`${API_BASE}/api/batches/${encodeURIComponent(batchId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      const batches = MockData.getPreviewBatches();
      const match = batches.find(b => b.id === batchId) || batches[0];
      return {
        batch: match,
        readings_count: 25,
        readings: MockData.getPreviewHistory(),
        analysis: MockData.getPreviewPrediction()
      };
    }
  },

  async resetSimulation(phase = 'stationary') {
    try {
      const res = await fetch(`${API_BASE}/api/simulation/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  async tickSimulation() {
    try {
      const res = await fetch(`${API_BASE}/api/simulation/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  async saveSupabaseConfig(url, key, table) {
    try {
      const res = await fetch(`${API_BASE}/api/config/supabase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supabase_url: url,
          supabase_key: key,
          supabase_table: table
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      return { error: 'Backend server offline. Connect Render backend URL first.' };
    }
  },

  setBackendUrl(url) {
    if (url && url.trim()) {
      localStorage.setItem('BIOPROCESS_API_BASE', url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem('BIOPROCESS_API_BASE');
    }
  },

  getBackendUrl() {
    return (typeof localStorage !== 'undefined' && localStorage.getItem('BIOPROCESS_API_BASE')) || '';
  }
};

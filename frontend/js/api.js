/**
 * Bioprocess API Client
 * Communicates with the Python Flask Backend and Supabase proxy
 * Includes seamless Offline Preview Fallback for cloud static deployments (Vercel)
 */

// Dynamic API Base: Checks runtime override, localStorage, or defaults to current origin
const API_BASE = (typeof window !== 'undefined' && window.__API_URL__) 
  || (typeof localStorage !== 'undefined' && localStorage.getItem('BIOPROCESS_API_BASE')) 
  || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');

const MockData = {
  getPreviewBatch() {
    return {
      id: "preview-batch-live",
      batch_name: "Live Bioprocess Reactor Run #03 (Interactive Preview)",
      scientist_name: "IDEA Lab Lead Researcher",
      organism: "Saccharomyces cerevisiae",
      broth_type: "Standard YPD Nutrient Broth",
      started_at: new Date(Date.now() - 4.2 * 3600000).toISOString(),
      status: "active",
      notes: "Interactive preview active until Render backend is deployed & connected."
    };
  },
  getPreviewHistory() {
    const points = [];
    const count = 22;
    const startTime = Date.now() - 4.2 * 3600000;
    const stepMs = (4.2 * 3600000) / count;
    for (let i = 0; i <= count; i++) {
      const t = i * (4.2 / count);
      const turb = Math.round(100 + 640 / (1 + Math.exp(-1.4 * (t - 2.4))) + (Math.random() * 4 - 2));
      const temp = Number((31.8 + 0.4 * Math.sin(t) + (Math.random() * 0.2 - 0.1)).toFixed(1));
      const ph = Number((7.05 - 1.45 / (1 + Math.exp(-1.3 * (t - 2.1))) + (Math.random() * 0.03 - 0.015)).toFixed(2));
      const gas = Math.round(410 + 1380 / (1 + Math.exp(-1.5 * (t - 2.5))) + (Math.random() * 15 - 7));
      points.push({
        id: `preview-pt-${i}`,
        created_at: new Date(startTime + i * stepMs).toISOString(),
        turbidity: turb,
        temperature: temp,
        ph: ph,
        gas: gas,
        time_elapsed_hours: Number(t.toFixed(2))
      });
    }
    return points;
  },
  getPreviewPrediction() {
    const history = this.getPreviewHistory();
    const latest = history[history.length - 1];
    return {
      current_status: "Log Phase (Exponential Growth)",
      phase_code: "log",
      growth_rate_formatted: "+22.4% per hr",
      estimated_peak: "~1.5 - 2.0 Hours Remaining",
      recommendation: "Continue incubation. Rapid cellular proliferation active. Monitor headspace off-gas.",
      environmental_alerts: [],
      data_source: "offline_preview",
      latest_reading: latest,
      metrics: {
        peak_turbidity: latest.turbidity,
        peak_gas: latest.gas,
        batch_duration_hours: 4.2,
        total_readings: history.length,
        carrying_capacity_k: 760.0
      },
      phase_milestones: {
        inoculation_start: { timestamp: history[0].created_at, turbidity: 105.0, ph: 7.05 },
        log_acceleration: { timestamp: history[6].created_at, time_hr: 1.2, turbidity: 220.0, growth_rate: 64.0 },
        maximum_inflection: { timestamp: history[13].created_at, time_hr: 2.5, turbidity: 470.0, max_rate: 110.5 },
        peak_harvest_target: { timestamp: new Date(Date.now() + 1.8 * 3600000).toISOString(), projected_time_hr: 6.0, estimated_turbidity: 755.0, recommendation: "Harvest when rate drops < 15 NTU/h" },
        harvest_stop_actual: null,
        death_decay_onset: null
      },
      predicted_projection: [
        { time_hr: 4.5, projected_turbidity: 710.0 },
        { time_hr: 5.0, projected_turbidity: 738.0 },
        { time_hr: 5.5, projected_turbidity: 752.0 },
        { time_hr: 6.0, projected_turbidity: 758.0 },
        { time_hr: 6.5, projected_turbidity: 760.0 }
      ],
      derivative_curve: [
        { time_hr: 0.5, dN_dt: 16.5 },
        { time_hr: 1.0, dN_dt: 40.2 },
        { time_hr: 1.5, dN_dt: 75.8 },
        { time_hr: 2.0, dN_dt: 104.0 },
        { time_hr: 2.5, dN_dt: 110.5 },
        { time_hr: 3.0, dN_dt: 92.4 },
        { time_hr: 3.5, dN_dt: 65.1 },
        { time_hr: 4.0, dN_dt: 35.8 },
        { time_hr: 4.5, dN_dt: 19.4 }
      ]
    };
  },
  getPreviewBatches() {
    return [
      {
        id: "batch-past-001",
        batch_name: "Yeast Kinetics Calibration Batch #01",
        scientist_name: "Dr. A. Sharma",
        organism: "S. cerevisiae (Standard Strain)",
        broth_type: "YPD Nutrient Broth",
        started_at: new Date(Date.now() - 48 * 3600000).toISOString(),
        stopped_at: new Date(Date.now() - 40 * 3600000).toISOString(),
        status: "completed",
        peak_turbidity: 792.0,
        peak_gas: 2450.0,
        harvest_delay_minutes: 0,
        notes: "Successful calibration run. Clean stationary inflection."
      },
      {
        id: "batch-past-002",
        batch_name: "High Carbon Substrate Run #02",
        scientist_name: "Research Team A",
        organism: "S. cerevisiae (High Osmotolerant)",
        broth_type: "Glucose-Enriched Broth (4% w/v)",
        started_at: new Date(Date.now() - 24 * 3600000).toISOString(),
        stopped_at: new Date(Date.now() - 17 * 3600000).toISOString(),
        status: "completed",
        peak_turbidity: 845.0,
        peak_gas: 2910.0,
        harvest_delay_minutes: 12,
        notes: "Substrate depleted at 6.8h. Gas generation peaked at 2910 PPM."
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
      console.warn('Backend server offline or unreachable. Using interactive preview mode.', err);
      this.isOffline = true;
      return {
        status: 'offline_preview',
        app_name: 'Bioprocess Monitoring & Prediction (Preview Mode)',
        supabase: { status: 'unconfigured', message: 'Connect Render Backend to link Supabase' },
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
      return hist[hist.length - 1];
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
      return { count: pts.length, data: pts };
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

  // -------------------------------------------------------------
  // BATCH / EXPERIMENT LIFECYCLE APIS
  // -------------------------------------------------------------
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
      console.warn('Simulating batch start in offline preview');
      return {
        success: true,
        batch: {
          id: `preview-batch-${Date.now().toString(36)}`,
          batch_name: batchData.batch_name || 'New Reaction Run',
          scientist_name: batchData.scientist_name || 'Lead Researcher',
          organism: batchData.organism || 'S. cerevisiae',
          broth_type: batchData.broth_type || 'YPD Broth',
          started_at: new Date().toISOString(),
          status: 'active'
        }
      };
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
      return {
        success: true,
        batch: {
          batch_name: 'Current Bioprocess Run',
          stopped_at: new Date().toISOString(),
          harvest_delay_minutes: 0
        }
      };
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
        readings_count: 20,
        readings: MockData.getPreviewHistory(),
        analytics: MockData.getPreviewPrediction()
      };
    }
  },

  // -------------------------------------------------------------
  // SIMULATION & SETTINGS
  // -------------------------------------------------------------
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
      return { message: `Preview phase set to ${phase}` };
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
      return { message: 'Tick generated in preview' };
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
      return { error: 'Backend server offline. Please connect Render backend first.' };
    }
  },

  setBackendUrl(url) {
    if (url && url.trim()) {
      const cleanUrl = url.trim().replace(/\/+$/, '');
      localStorage.setItem('BIOPROCESS_API_BASE', cleanUrl);
    } else {
      localStorage.removeItem('BIOPROCESS_API_BASE');
    }
  },

  getBackendUrl() {
    return (typeof localStorage !== 'undefined' && localStorage.getItem('BIOPROCESS_API_BASE')) || '';
  }
};

/**
 * Bioprocess API Client
 * Communicates with the Python Flask Backend and Supabase proxy
 */

const API_BASE = window.location.origin;

const Api = {
  async getStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      return await res.json();
    } catch (err) {
      console.error('Failed to get status:', err);
      return { status: 'offline', error: err.message };
    }
  },

  async getLatestTelemetry(batchId = null) {
    try {
      const url = batchId 
        ? `${API_BASE}/api/telemetry/latest?batch_id=${encodeURIComponent(batchId)}` 
        : `${API_BASE}/api/telemetry/latest`;
      const res = await fetch(url);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch latest telemetry:', err);
      return null;
    }
  },

  async getHistory(limit = 100, batchId = null) {
    try {
      const url = batchId
        ? `${API_BASE}/api/telemetry/history?limit=${limit}&batch_id=${encodeURIComponent(batchId)}`
        : `${API_BASE}/api/telemetry/history?limit=${limit}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch telemetry history:', err);
      return { count: 0, data: [] };
    }
  },

  async getPrediction(limit = 100, batchId = null) {
    try {
      const url = batchId
        ? `${API_BASE}/api/analytics/predict?limit=${limit}&batch_id=${encodeURIComponent(batchId)}`
        : `${API_BASE}/api/analytics/predict?limit=${limit}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch growth prediction:', err);
      return null;
    }
  },

  // -------------------------------------------------------------
  // BATCH / EXPERIMENT LIFECYCLE APIS
  // -------------------------------------------------------------
  async getBatches(limit = 10) {
    try {
      const res = await fetch(`${API_BASE}/api/batches?limit=${limit}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch batches:', err);
      return { count: 0, data: [] };
    }
  },

  async getActiveBatch() {
    try {
      const res = await fetch(`${API_BASE}/api/batches/active`);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch active batch:', err);
      return { active: false, data: null };
    }
  },

  async startBatch(batchData) {
    try {
      const res = await fetch(`${API_BASE}/api/batches/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchData)
      });
      return await res.json();
    } catch (err) {
      console.error('Failed to start batch:', err);
      return { error: err.message };
    }
  },

  async stopBatch(payload = {}) {
    try {
      const res = await fetch(`${API_BASE}/api/batches/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (err) {
      console.error('Failed to stop batch:', err);
      return { error: err.message };
    }
  },

  async getBatchDetails(batchId) {
    try {
      const res = await fetch(`${API_BASE}/api/batches/${encodeURIComponent(batchId)}`);
      return await res.json();
    } catch (err) {
      console.error(`Failed to fetch batch ${batchId}:`, err);
      return null;
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
      return await res.json();
    } catch (err) {
      console.error('Failed to reset simulation:', err);
      return { error: err.message };
    }
  },

  async tickSimulation() {
    try {
      const res = await fetch(`${API_BASE}/api/simulation/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return await res.json();
    } catch (err) {
      console.error('Failed to tick simulation:', err);
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
      return await res.json();
    } catch (err) {
      console.error('Failed to save config:', err);
      return { error: err.message };
    }
  }
};

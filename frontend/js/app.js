/**
 * Bioprocess Research Studio UI Controller
 * Manages Batch Lifecycle, Live Sensor Telemetry, Harvest Execution, and Historical Replay
 */

let refreshIntervalMs = 4000;
let refreshTimer = null;
let isRefreshing = false;

let currentActiveBatch = null;
let viewingHistoricalBatchId = null;
let lastHarvestRecommendedAt = null;
let cachedBatchesList = [];

document.addEventListener('DOMContentLoaded', async () => {
  ChartsManager.initCharts();
  setupEventListeners();
  await refreshDashboard();
  startAutoRefresh();
});

// -------------------------------------------------------------
// NON-BLOCKING TOAST NOTIFICATION HELPER
// -------------------------------------------------------------
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const borderMap = {
    success: 'border-emerald-500/50 bg-[#0f141b] text-emerald-300',
    warning: 'border-amber-500/50 bg-[#0f141b] text-amber-300',
    error: 'border-red-500/50 bg-[#0f141b] text-red-300',
    info: 'border-sky-500/50 bg-[#0f141b] text-sky-300'
  };

  const el = document.createElement('div');
  el.className = `toast-enter pointer-events-auto p-3.5 rounded-lg border shadow-2xl ${borderMap[type] || borderMap.info}`;
  el.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="space-y-0.5 text-xs">
        <div class="font-semibold text-slate-100">${title}</div>
        <div class="text-[11px] text-slate-400 leading-relaxed">${message}</div>
      </div>
      <button class="text-slate-500 hover:text-slate-200 text-sm leading-none" onclick="this.parentElement.parentElement.remove()">&times;</button>
    </div>
  `;

  container.appendChild(el);
  setTimeout(() => {
    if (el.parentElement) el.remove();
  }, 5000);
}

function setupEventListeners() {
  // 1. Auto-refresh polling selector
  const intervalSelect = document.getElementById('intervalSelect');
  if (intervalSelect) {
    intervalSelect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val === 0) {
        stopAutoRefresh();
        showToast('Telemetry Paused', 'Live polling paused. Select a polling cadence to resume.', 'info');
      } else {
        refreshIntervalMs = val * 1000;
        startAutoRefresh();
        showToast('Polling Updated', `Streaming telemetry every ${val}s.`, 'info');
      }
    });
  }

  // 2. Collapsible Bench Simulator Drawer Toggle
  const toggleSimBtn = document.getElementById('toggleSimDrawerBtn');
  const simDrawer = document.getElementById('simControlsDrawer');
  if (toggleSimBtn && simDrawer) {
    toggleSimBtn.addEventListener('click', () => {
      simDrawer.classList.toggle('hidden');
      toggleSimBtn.classList.toggle('border-sky-500/50');
    });
  }

  // 3. Bench Simulator Preset Actions
  document.querySelectorAll('.phase-preset-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = e.currentTarget;
      const originalText = target.innerText;
      const phase = target.dataset.phase;
      target.disabled = true;
      target.innerText = 'Applying...';
      await Api.resetSimulation(phase);
      await refreshDashboard();
      target.disabled = false;
      target.innerText = originalText;
    });
  });

  const tickBtn = document.getElementById('tickSimBtn');
  if (tickBtn) {
    tickBtn.addEventListener('click', async () => {
      tickBtn.disabled = true;
      await Api.tickSimulation();
      await refreshDashboard();
      tickBtn.disabled = false;
    });
  }

  // 4. Start Reaction Modal
  const startModal = document.getElementById('startBatchModal');
  const openStartBtn = document.getElementById('openStartBatchModalBtn');
  const closeStartBtn = document.getElementById('closeStartBatchModalBtn');
  const cancelStartBtn = document.getElementById('cancelStartBatchBtn');
  const startForm = document.getElementById('startBatchForm');

  if (openStartBtn && startModal) {
    openStartBtn.addEventListener('click', () => {
      document.getElementById('startBatchError')?.classList.add('hidden');
      startModal.classList.remove('hidden');
    });
  }

  const closeStartModal = () => startModal?.classList.add('hidden');
  closeStartBtn?.addEventListener('click', closeStartModal);
  cancelStartBtn?.addEventListener('click', closeStartModal);

  if (startForm) {
    startForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const batchName = document.getElementById('inputBatchName').value.trim();
      const scientistName = document.getElementById('inputScientistName').value.trim();
      const organism = document.getElementById('inputOrganism').value.trim();
      const brothType = document.getElementById('inputBroth').value.trim();
      const notes = document.getElementById('inputNotes').value.trim();
      const errorDiv = document.getElementById('startBatchError');

      if (!batchName || !scientistName) {
        errorDiv.innerText = 'Batch title and lead operator name are required.';
        errorDiv.classList.remove('hidden');
        return;
      }

      const res = await Api.startBatch({
        batch_name: batchName,
        scientist_name: scientistName,
        organism,
        broth_type: brothType,
        notes
      });

      if (res.success) {
        viewingHistoricalBatchId = null;
        lastHarvestRecommendedAt = null;
        closeStartModal();
        startForm.reset();
        showToast('Batch Initialized', `Started fermentation run "${batchName}".`, 'success');
        await refreshDashboard();
      } else {
        errorDiv.innerText = res.error || 'Failed to initialize reaction.';
        errorDiv.classList.remove('hidden');
      }
    });
  }

  // 5. Stop & Harvest Modal (Replaces native confirm/alert dialogs)
  const stopBtn = document.getElementById('stopBatchBtn');
  const stopModal = document.getElementById('stopConfirmModal');
  const stopBatchNameSpan = document.getElementById('stopConfirmBatchName');
  const confirmStopBtn = document.getElementById('confirmStopExecuteBtn');
  const cancelStopBtn = document.getElementById('cancelStopConfirmBtn');
  const closeStopBtn = document.getElementById('closeStopConfirmBtn');

  const closeStopModal = () => stopModal?.classList.add('hidden');
  cancelStopBtn?.addEventListener('click', closeStopModal);
  closeStopBtn?.addEventListener('click', closeStopModal);

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (!currentActiveBatch || currentActiveBatch.status !== 'active') {
        showToast('No Active Batch', 'No active fermentation run is currently recording.', 'warning');
        return;
      }
      if (stopBatchNameSpan) stopBatchNameSpan.innerText = currentActiveBatch.batch_name;
      stopModal?.classList.remove('hidden');
    });
  }

  if (confirmStopBtn) {
    confirmStopBtn.addEventListener('click', async () => {
      confirmStopBtn.disabled = true;
      confirmStopBtn.innerText = 'Terminating...';
      const res = await Api.stopBatch({
        harvest_recommended_at: lastHarvestRecommendedAt,
        reason: 'harvested'
      });
      confirmStopBtn.disabled = false;
      confirmStopBtn.innerText = 'Confirm & Harvest Batch';
      closeStopModal();

      if (res.success) {
        const stoppedTime = new Date(res.batch.stopped_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        const adherence = res.batch.harvest_delay_minutes
          ? `${res.batch.harvest_delay_minutes} min post-peak variance`
          : 'Harvested on target window';
        showToast('Batch Completed', `${res.batch.batch_name} archived at ${stoppedTime} (${adherence}).`, 'success');
        await refreshDashboard();
      } else {
        showToast('Termination Failed', res.error || 'Unable to stop active batch.', 'error');
      }
    });
  }

  // 6. Past Bioprocess Archive Modal
  const historyModal = document.getElementById('historyModal');
  const openHistoryBtn = document.getElementById('openHistoryModalBtn');
  const closeHistoryBtn = document.getElementById('closeHistoryModalBtn');
  const closeHistoryBtn2 = document.getElementById('closeHistoryModalBtn2');

  if (openHistoryBtn && historyModal) {
    openHistoryBtn.addEventListener('click', async () => {
      historyModal.classList.remove('hidden');
      await loadPastBatchesList();
    });
  }

  const closeHistory = () => historyModal?.classList.add('hidden');
  closeHistoryBtn?.addEventListener('click', closeHistory);
  closeHistoryBtn2?.addEventListener('click', closeHistory);

  // Exit Historical Replay Mode
  const exitReplayBtn = document.getElementById('exitReplayBtn');
  if (exitReplayBtn) {
    exitReplayBtn.addEventListener('click', async () => {
      viewingHistoricalBatchId = null;
      document.getElementById('historicalArchiveNotice')?.classList.add('hidden');
      await refreshDashboard();
    });
  }

  // -------------------------------------------------------------
  // SUPABASE & BACKEND SETTINGS MODAL
  // -------------------------------------------------------------
  const openModalBtn = document.getElementById('openSettingsBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const settingsModal = document.getElementById('settingsModal');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const quickBackendInput = document.getElementById('quickBackendUrlInput');
  const quickConnectBtn = document.getElementById('quickConnectBackendBtn');
  const backendApiUrlInput = document.getElementById('backendApiUrlInput');

  // Quick Backend Connector in top offline banner
  const quickBackendInput = document.getElementById('quickBackendUrlInput');
  const quickConnectBtn = document.getElementById('quickConnectBackendBtn');
  const backendApiUrlInput = document.getElementById('backendApiUrlInput');

  if (quickBackendInput && Api.getBackendUrl()) {
    quickBackendInput.value = Api.getBackendUrl();
  }
  if (backendApiUrlInput && Api.getBackendUrl()) {
    backendApiUrlInput.value = Api.getBackendUrl();
  }

  const handleConnectBackend = (url) => {
    if (!url || !url.trim()) {
      Api.setBackendUrl('');
      alert('Reset to default backend URL. Reloading...');
      location.reload();
      return;
    }
    const clean = url.trim().replace(/\/+$/, '');
    Api.setBackendUrl(clean);
    alert(`Connected to backend: ${clean}\nReloading research dashboard...`);
    location.reload();
  };

  if (quickConnectBtn && quickBackendInput) {
    quickConnectBtn.addEventListener('click', () => {
      handleConnectBackend(quickBackendInput.value);
    });
  }

  if (openModalBtn && settingsModal) {
    openModalBtn.addEventListener('click', () => {
      if (backendApiUrlInput) backendApiUrlInput.value = Api.getBackendUrl();
      settingsModal.classList.remove('hidden');
    });
  }
  if (backendApiUrlInput && Api.getBackendUrl()) {
    backendApiUrlInput.value = Api.getBackendUrl();
  }

  if (quickConnectBtn && quickBackendInput) {
    quickConnectBtn.addEventListener('click', () => {
      const url = quickBackendInput.value.trim();
      Api.setBackendUrl(url);
      showToast('Backend Linked', url ? `Target set to ${url}. Reloading console...` : 'Reset to default origin.', 'info');
      setTimeout(() => location.reload(), 650);
    });
  }

  if (openModalBtn && settingsModal) {
    openModalBtn.addEventListener('click', () => {
      if (backendApiUrlInput) backendApiUrlInput.value = Api.getBackendUrl();
      settingsModal.classList.remove('hidden');
    });
  }
  closeModalBtn?.addEventListener('click', () => settingsModal?.classList.add('hidden'));

  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
      const url = document.getElementById('supabaseUrlInput').value.trim();
      const key = document.getElementById('supabaseKeyInput').value.trim();
      const table = document.getElementById('supabaseTableInput').value.trim() || 'bioprocess_readings';
      const backendUrl = backendApiUrlInput ? backendApiUrlInput.value.trim() : '';
      const statusDiv = document.getElementById('configTestStatus');

      if (backendUrl !== Api.getBackendUrl()) {
        Api.setBackendUrl(backendUrl);
      }

      statusDiv.innerHTML = '<span class="text-blue-400">Testing connection...</span>';
      const res = await Api.saveSupabaseConfig(url, key, table);

      if (res.success) {
        statusDiv.innerHTML = `<span class="text-emerald-400">Connected: ${res.message}</span>`;
        setTimeout(() => {
          settingsModal.classList.add('hidden');
          if (backendChanged) location.reload();
          else refreshDashboard();
        }, 1000);
      } else {
        statusDiv.innerHTML = `<span class="text-red-400">${res.error || 'Connection test failed'}</span>`;
      }
    });
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => {
    if (!viewingHistoricalBatchId) {
      refreshDashboard();
    }
  }, refreshIntervalMs);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// -------------------------------------------------------------
// MAIN DASHBOARD REFRESH LOOP
// -------------------------------------------------------------
async function refreshDashboard() {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    if (viewingHistoricalBatchId) {
      const batchDetails = await Api.getBatchDetails(viewingHistoricalBatchId);
      if (batchDetails && batchDetails.batch) {
        renderHistoricalBatch(batchDetails);
      }
      return;
    }

    document.getElementById('historicalArchiveNotice')?.classList.add('hidden');

    const [activeBatchRes, prediction, history, statusInfo, batchesRes] = await Promise.all([
      Api.getActiveBatch(),
      Api.getPrediction(100),
      Api.getHistory(100),
      Api.getStatus(),
      Api.getBatches(10)
    ]);

    currentActiveBatch = activeBatchRes?.data || null;
    cachedBatchesList = batchesRes?.data || [];

    // Toggle offline connection banner
    const offlineBanner = document.getElementById('backendOfflineBanner');
    if (offlineBanner) {
      if (Api.isOffline) {
        offlineBanner.classList.remove('hidden');
      } else {
        offlineBanner.classList.add('hidden');
      }
    }

    updateActiveBatchBanner(currentActiveBatch);
    updateSystemStatusPill(statusInfo, prediction?.data_source);
    updatePredictionHero(prediction);
    updateMetricCards(prediction);
    updateLifecycleMilestones(prediction, currentActiveBatch);
    renderQuickBatchPills(cachedBatchesList);
    updateHistoryTable(history?.data || []);
    ChartsManager.updateCharts(history?.data || [], prediction, currentActiveBatch);

    if (prediction?.phase_code === 'stationary' && !lastHarvestRecommendedAt) {
      lastHarvestRecommendedAt = new Date().toISOString();
    }
  } catch (err) {
    console.error('Dashboard sync error:', err);
  } finally {
    isRefreshing = false;
  }
}

function updateActiveBatchBanner(batch) {
  const nameEl = document.getElementById('batchNameDisplay');
  const sciEl = document.getElementById('batchScientistDisplay');
  const orgEl = document.getElementById('batchOrganismDisplay');
  const startEl = document.getElementById('batchStartedDisplay');
  const idEl = document.getElementById('batchIdDisplay');
  const badgeEl = document.getElementById('batchStatusBadge');

  if (!batch) {
    if (nameEl) nameEl.innerText = 'No active reaction (Click "+ New Batch" to start)';
    if (sciEl) sciEl.innerText = '--';
    if (orgEl) orgEl.innerText = '--';
    if (startEl) startEl.innerText = '--';
    if (idEl) idEl.innerText = 'ID: --';
    if (badgeEl) {
      badgeEl.className = 'px-2 py-0.5 rounded text-[10px] font-semibold uppercase mono-font bg-[#151c26] text-slate-400 border border-[#263140] shrink-0';
      badgeEl.innerText = 'STANDBY';
    }
    return;
  }

  if (nameEl) nameEl.innerText = batch.batch_name;
  if (sciEl) sciEl.innerText = batch.scientist_name;
  if (orgEl) orgEl.innerText = batch.organism || 'S. cerevisiae';
  if (idEl) idEl.innerText = `ID: ${batch.id.substring(0, 8)}`;

  if (startEl && batch.started_at) {
    const sDate = new Date(batch.started_at);
    startEl.innerText = `${sDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${sDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }

  if (badgeEl) {
    if (batch.status === 'active') {
      badgeEl.className = 'px-2 py-0.5 rounded text-[10px] font-semibold uppercase mono-font bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0';
      badgeEl.innerText = 'LIVE INCUBATION';
    } else {
      badgeEl.className = 'px-2 py-0.5 rounded text-[10px] font-semibold uppercase mono-font bg-sky-500/15 text-sky-400 border border-sky-500/30 shrink-0';
      badgeEl.innerText = 'COMPLETED';
    }
  }
}

function updateSystemStatusPill(statusInfo, dataSource) {
  const pill = document.getElementById('cloudStatusPill');
  const text = document.getElementById('cloudStatusText');
  const dot = document.getElementById('cloudStatusDot');
  if (!pill || !text || !dot) return;

  if (Api.isOffline || dataSource === 'offline_preview') {
    pill.className = 'px-2 py-0.5 rounded text-[10px] font-semibold mono-font flex items-center space-x-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0';
    text.innerText = 'PREVIEW';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400';
  } else if (dataSource === 'supabase' && statusInfo?.is_supabase_configured) {
    pill.className = 'px-2 py-0.5 rounded text-[10px] font-semibold mono-font flex items-center space-x-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0';
    text.innerText = 'SUPABASE LIVE';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 live-pulse';
  } else {
    pill.className = 'px-2 py-0.5 rounded text-[10px] font-semibold mono-font flex items-center space-x-1.5 bg-sky-500/10 border border-sky-500/30 text-sky-400 shrink-0';
    text.innerText = 'SIMULATION';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-sky-400 live-pulse';
  }
}

function getDirectiveSvg(phase) {
  if (phase === 'stationary') {
    return '<svg class="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  }
  if (phase === 'death') {
    return '<svg class="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  }
  if (phase === 'log') {
    return '<svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>';
  }
  return '<svg class="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
}

function updatePredictionHero(pred) {
  if (!pred) return;

  const statusBadge = document.getElementById('heroStatusBadge');
  const statusText = document.getElementById('heroStatusText');
  const peakText = document.getElementById('heroPeakText');
  const rateText = document.getElementById('heroRateText');
  const trendText = document.getElementById('heroTrendText');
  const recoBox = document.getElementById('heroRecommendationBox');
  const recoText = document.getElementById('heroRecommendationText');
  const recoIcon = document.getElementById('heroRecommendationIcon');

  if (statusText) statusText.innerText = pred.current_status || 'Unknown';
  if (peakText) peakText.innerText = pred.estimated_peak || '--';
  if (rateText) rateText.innerText = pred.growth_rate_formatted || '--';
  if (trendText) trendText.innerText = pred.growth_trend || '--';
  if (recoText) recoText.innerText = pred.recommendation || '--';

  const phase = pred.phase_code || 'log';
  if (statusBadge) {
    statusBadge.className = `px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider mono-font badge-${phase}`;
    statusBadge.innerText = phase.toUpperCase();
  }

  if (recoBox) {
    const boxStyles = {
      stationary: 'p-4 sm:p-5 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] text-amber-100 space-y-2',
      log: 'p-4 sm:p-5 rounded-lg border border-emerald-500/35 bg-emerald-500/[0.07] text-emerald-100 space-y-2',
      death: 'p-4 sm:p-5 rounded-lg border border-red-500/40 bg-red-500/[0.08] text-red-100 space-y-2',
      lag: 'p-4 sm:p-5 rounded-lg border border-blue-500/35 bg-blue-500/[0.07] text-blue-100 space-y-2'
    };
    recoBox.className = boxStyles[phase] || 'p-4 sm:p-5 rounded-lg border border-[#263140] bg-[#151c26] text-slate-200 space-y-2';
    if (recoIcon) recoIcon.innerHTML = getDirectiveSvg(phase);
  }

  const alertsContainer = document.getElementById('envAlertsContainer');
  if (alertsContainer) {
    if (pred.environmental_alerts && pred.environmental_alerts.length > 0) {
      alertsContainer.innerHTML = pred.environmental_alerts.map(a => `
        <div class="px-3 py-2 rounded text-[11px] flex items-center space-x-2 ${a.type === 'danger' ? 'bg-red-500/15 text-red-300 border border-red-500/30' : 'bg-[#151c26] text-slate-300 border border-[#263140]'}">
          <span class="w-1.5 h-1.5 rounded-full ${a.type === 'danger' ? 'bg-red-400' : 'bg-sky-400'} shrink-0"></span>
          <span>${a.message}</span>
        </div>
      `).join('');
      alertsContainer.classList.remove('hidden');
    } else {
      alertsContainer.classList.add('hidden');
      alertsContainer.innerHTML = '';
    }
  }
}

function updateMetricCards(pred) {
  if (!pred || !pred.latest_reading) return;

  const reading = pred.latest_reading;
  const metrics = pred.metrics || {};

  const turbVal = document.getElementById('metricTurbidity');
  const turbPeak = document.getElementById('metricTurbidityPeak');
  if (turbVal) turbVal.innerText = `${reading.turbidity} NTU`;
  if (turbPeak) turbPeak.innerText = `Peak: ${metrics.peak_turbidity || reading.turbidity} NTU`;

  const tempVal = document.getElementById('metricTemp');
  const tempStatus = document.getElementById('metricTempStatus');
  if (tempVal) tempVal.innerText = `${reading.temperature} °C`;
  if (tempStatus) {
    if (reading.temperature >= 28.0 && reading.temperature <= 36.0) {
      tempStatus.innerHTML = '<span class="text-emerald-400">Optimal</span>';
    } else {
      tempStatus.innerHTML = '<span class="text-amber-400">Suboptimal</span>';
    }
  }

  const phVal = document.getElementById('metricPH');
  const phDelta = document.getElementById('metricPHDelta');
  if (phVal) phVal.innerText = `${reading.ph}`;
  if (phDelta) {
    const delta = (reading.ph - 7.0).toFixed(2);
    phDelta.innerText = `Delta: ${delta > 0 ? '+' : ''}${delta}`;
  }

  const gasVal = document.getElementById('metricGas');
  const gasPeak = document.getElementById('metricGasPeak');
  if (gasVal) gasVal.innerText = `${reading.gas || 400} PPM`;
  if (gasPeak) gasPeak.innerText = `Peak: ${metrics.peak_gas || reading.gas || 400} PPM`;

  const durVal = document.getElementById('metricDuration');
  const countVal = document.getElementById('metricReadingsCount');
  if (durVal) {
    let durText = '0 min';
    if (metrics.batch_duration_formatted) {
      durText = metrics.batch_duration_formatted;
    } else if (currentActiveBatch?.started_at) {
      const s = new Date(currentActiveBatch.started_at).getTime();
      const e = currentActiveBatch.stopped_at ? new Date(currentActiveBatch.stopped_at).getTime() : Date.now();
      const mTotal = Math.max(0, Math.round((e - s) / 60000));
      const h = Math.floor(mTotal / 60);
      const m = mTotal % 60;
      durText = h > 0 ? `${h}h ${m}m` : `${m} min`;
    } else if (metrics.batch_duration_hours !== undefined) {
      const mTotal = Math.round(Number(metrics.batch_duration_hours) * 60);
      const h = Math.floor(mTotal / 60);
      const m = mTotal % 60;
      durText = h > 0 ? `${h}h ${m}m` : `${m} min`;
    }
    durVal.innerText = durText;
  }
  if (countVal) countVal.innerText = `${metrics.total_readings || 0} samples`;
}

function updateLifecycleMilestones(analysis, batch) {
  const ms = analysis?.phase_milestones || {};
  const metrics = analysis?.metrics || {};

  const startEl = document.getElementById('msStartTime');
  const startTurbEl = document.getElementById('msStartTurb');
  const startPHEl = document.getElementById('msStartPH');

  if (ms.inoculation_start) {
    const sDate = new Date(ms.inoculation_start.timestamp);
    if (startEl) startEl.innerText = `${sDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${sDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    if (startTurbEl) startTurbEl.innerText = `${ms.inoculation_start.turbidity} NTU`;
    if (startPHEl) startPHEl.innerText = `${ms.inoculation_start.ph}`;
  } else if (batch?.started_at) {
    const sDate = new Date(batch.started_at);
    if (startEl) startEl.innerText = `${sDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${sDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    if (startTurbEl) startTurbEl.innerText = '105.0 NTU';
    if (startPHEl) startPHEl.innerText = '7.05';
  }

  const logTimeEl = document.getElementById('msLogTime');
  const logHrEl = document.getElementById('msLogTimeHr');
  const logTurbEl = document.getElementById('msLogTurb');

  if (ms.log_acceleration) {
    const lDate = new Date(ms.log_acceleration.timestamp);
    if (logTimeEl) logTimeEl.innerText = lDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (logHrEl) logHrEl.innerText = `t=${ms.log_acceleration.time_hr}h`;
    if (logTurbEl) logTurbEl.innerText = `${ms.log_acceleration.turbidity} NTU`;
  } else {
    if (logTimeEl) logTimeEl.innerText = analysis?.phase_code === 'lag' ? 'Adapting' : 'Early Log';
    if (logHrEl) logHrEl.innerText = 't=~1.5h';
    if (logTurbEl) logTurbEl.innerText = '--';
  }

  const peakTimeEl = document.getElementById('msPeakTime');
  const peakHrEl = document.getElementById('msPeakTimeHr');
  const peakTurbEl = document.getElementById('msPeakTurb');

  if (ms.peak_biomass) {
    const pDate = new Date(ms.peak_biomass.timestamp);
    if (peakTimeEl) peakTimeEl.innerText = `${pDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${pDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    if (peakHrEl) peakHrEl.innerText = `t=${ms.peak_biomass.time_hr}h`;
    if (peakTurbEl) peakTurbEl.innerText = `${ms.peak_biomass.turbidity} NTU`;
  } else if (batch?.peak_turbidity) {
    if (peakTimeEl) peakTimeEl.innerText = 'Peak Logged';
    if (peakHrEl) peakHrEl.innerText = 'Max';
    if (peakTurbEl) peakTurbEl.innerText = `${batch.peak_turbidity} NTU`;
  } else {
    if (peakTimeEl) peakTimeEl.innerText = analysis?.estimated_peak || 'Estimating...';
    if (peakHrEl) peakHrEl.innerText = '--';
    if (peakTurbEl) peakTurbEl.innerText = `Proj: ${metrics.predicted_carrying_capacity_K || 795} NTU`;
  }

  const recoTimeEl = document.getElementById('msRecoTime');
  const recoHrEl = document.getElementById('msRecoTimeHr');
  const peakGasEl = document.getElementById('msPeakGas');

  if (ms.harvest_window) {
    const rDate = new Date(ms.harvest_window.timestamp);
    if (recoTimeEl) recoTimeEl.innerText = rDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (recoHrEl) recoHrEl.innerText = `t=${ms.harvest_window.time_hr}h`;
  } else if (batch?.harvest_recommended_at) {
    const rDate = new Date(batch.harvest_recommended_at);
    if (recoTimeEl) recoTimeEl.innerText = rDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (recoHrEl) recoHrEl.innerText = 'Plateau Hit';
  } else {
    if (recoTimeEl) recoTimeEl.innerText = 'Pending Peak';
    if (recoHrEl) recoHrEl.innerText = 'Armed';
  }
  if (peakGasEl) peakGasEl.innerText = `${metrics.peak_gas || batch?.peak_gas || 400} PPM`;

  const stopTimeEl = document.getElementById('msStopTime');
  const stopAdhEl = document.getElementById('msStopAdherence');
  const adhTextEl = document.getElementById('msAdherenceText');

  if (batch?.stopped_at) {
    const stDate = new Date(batch.stopped_at);
    if (stopTimeEl) stopTimeEl.innerText = `${stDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${stDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;

    if (batch.harvest_delay_minutes === 0 || batch.harvest_delay_minutes === null) {
      if (stopAdhEl) {
        stopAdhEl.innerText = 'On-Time';
        stopAdhEl.className = 'text-emerald-400 font-semibold';
      }
      if (adhTextEl) adhTextEl.innerText = 'Harvested on target';
    } else {
      if (stopAdhEl) {
        stopAdhEl.innerText = `+${batch.harvest_delay_minutes}m`;
        stopAdhEl.className = 'text-amber-400 font-semibold';
      }
      if (adhTextEl) adhTextEl.innerText = `${batch.harvest_delay_minutes}m post-peak`;
    }
  } else {
    if (stopTimeEl) stopTimeEl.innerText = 'In Progress';
    if (stopAdhEl) {
      stopAdhEl.innerText = 'Live';
      stopAdhEl.className = 'text-sky-400 font-semibold';
    }
    if (adhTextEl) adhTextEl.innerText = 'Monitoring';
  }

  const decayTimeEl = document.getElementById('msDecayTime');
  const decayPillEl = document.getElementById('msDecayStatusPill');
  const decayDetailEl = document.getElementById('msDecayDetail');

  if (ms.decline_death) {
    const dDate = new Date(ms.decline_death.timestamp);
    if (decayTimeEl) decayTimeEl.innerText = `${dDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} (t=${ms.decline_death.time_hr}h)`;
    if (decayPillEl) {
      decayPillEl.innerText = 'LYSIS';
      decayPillEl.className = 'text-red-400 font-semibold';
    }
    if (decayDetailEl) {
      decayDetailEl.innerText = `-${ms.decline_death.loss_ntu} NTU drop`;
      decayDetailEl.className = 'text-red-300 font-semibold';
    }
  } else if (batch?.status === 'completed') {
    if (decayTimeEl) decayTimeEl.innerText = 'Prevented';
    if (decayPillEl) {
      decayPillEl.innerText = 'Preserved';
      decayPillEl.className = 'text-emerald-400 font-semibold';
    }
    if (decayDetailEl) {
      decayDetailEl.innerText = 'Harvested pre-lysis';
      decayDetailEl.className = 'text-emerald-300';
    }
  } else {
    if (decayTimeEl) decayTimeEl.innerText = 'None Detected';
    if (decayPillEl) {
      decayPillEl.innerText = 'Viable';
      decayPillEl.className = 'text-emerald-400 font-semibold';
    }
    if (decayDetailEl) {
      decayDetailEl.innerText = 'Biomass intact';
      decayDetailEl.className = 'text-slate-300';
    }
  }

  const mBadge = document.getElementById('milestoneBatchBadge');
  if (mBadge) {
    if (viewingHistoricalBatchId) {
      mBadge.className = 'px-2 py-0.5 rounded text-[10px] font-semibold uppercase mono-font bg-amber-500/15 text-amber-300 border border-amber-500/30';
      mBadge.innerText = `Replay: ${batch?.batch_name ? batch.batch_name.substring(0, 22) : 'Archive'}`;
    } else {
      mBadge.className = 'px-2 py-0.5 rounded text-[10px] font-semibold uppercase mono-font bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
      mBadge.innerText = 'Active Run';
    }
  }
}

function renderQuickBatchPills(batches = []) {
  const container = document.getElementById('quickBatchPillsContainer');
  if (!container) return;

  const isLiveActive = !viewingHistoricalBatchId;

  let html = `
    <button class="quick-pill-btn px-2.5 py-1 rounded text-[11px] font-medium transition-colors shrink-0 flex items-center space-x-1.5 ${isLiveActive ? 'bg-emerald-500 text-[#05130e] font-semibold' : 'bg-[#151c26] text-slate-300 hover:text-slate-100 border border-[#263140]'}" data-action="live">
      <span class="w-1.5 h-1.5 rounded-full ${isLiveActive ? 'bg-[#05130e]' : 'bg-emerald-400'}"></span>
      <span>Live Batch</span>
    </button>
  `;

  batches.forEach(b => {
    const isSelected = viewingHistoricalBatchId === b.id;
    const shortName = b.batch_name.length > 22 ? b.batch_name.substring(0, 20) + '...' : b.batch_name;
    const isCompleted = b.status === 'completed';

    html += `
      <button class="quick-pill-btn px-2.5 py-1 rounded text-[11px] font-medium transition-colors shrink-0 flex items-center space-x-1.5 ${isSelected ? 'bg-amber-500 text-[#080b0f] font-semibold' : 'bg-[#151c26] text-slate-300 hover:text-slate-100 border border-[#263140]'}" data-id="${b.id}">
        <span class="w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-sky-400' : 'bg-emerald-400'}"></span>
        <span>${shortName}</span>
      </button>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.quick-pill-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const action = e.currentTarget.dataset.action;
      const batchId = e.currentTarget.dataset.id;

      if (action === 'live') {
        viewingHistoricalBatchId = null;
        document.getElementById('historicalArchiveNotice')?.classList.add('hidden');
        await refreshDashboard();
      } else if (batchId) {
        viewingHistoricalBatchId = batchId;
        await refreshDashboard();
      }
    });
  });
}

function updateHistoryTable(data) {
  const tbody = document.getElementById('telemetryTableBody');
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-xs text-slate-500">No telemetry packets logged yet.</td></tr>';
    return;
  }

  const recent = [...data].reverse().slice(0, 8);
  tbody.innerHTML = recent.map((r) => {
    const timeStr = new Date(r.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    return `
      <tr class="hover:bg-[#151c26] transition-colors text-xs mono-font">
        <td class="py-2.5 px-3 text-slate-400">${timeStr}</td>
        <td class="py-2.5 px-3 font-semibold text-emerald-400">${r.turbidity} NTU</td>
        <td class="py-2.5 px-3 text-orange-400">${r.temperature} °C</td>
        <td class="py-2.5 px-3 text-violet-400">${r.ph}</td>
        <td class="py-2.5 px-3 text-cyan-400">${r.gas ? r.gas + ' PPM' : '400 PPM'}</td>
        <td class="py-2.5 px-3 text-slate-500">${r.device_id || 'ESP32_BIO_01'}</td>
      </tr>
    `;
  }).join('');
}

async function loadPastBatchesList() {
  const container = document.getElementById('batchesListContainer');
  if (!container) return;

  container.innerHTML = '<div class="text-center py-6 text-slate-400">Querying historical batch records...</div>';
  const res = await Api.getBatches(20);
  const batches = res?.data || [];

  if (batches.length === 0) {
    container.innerHTML = '<div class="text-center py-6 text-slate-500">No archived experiments found.</div>';
    return;
  }

  container.innerHTML = batches.map(b => {
    const sDate = new Date(b.started_at || b.created_at);
    const dateStr = sDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = sDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const isCompleted = b.status === 'completed';

    const startMs = sDate.getTime();
    const endMs = b.stopped_at ? new Date(b.stopped_at).getTime() : Date.now();
    const totalMins = Math.max(1, Math.round((endMs - startMs) / 60000));
    const durH = Math.floor(totalMins / 60);
    const durM = totalMins % 60;
    const runtimeStr = durH > 0 ? `${durH}h ${durM}m` : `${durM} min`;

    const stopTimeStr = b.stopped_at
      ? new Date(b.stopped_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
      : '';

    let adherenceBadge = '';
    if (isCompleted) {
      adherenceBadge = (b.harvest_delay_minutes === 0 || b.harvest_delay_minutes === null)
        ? '<span class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold mono-font">ON-TIME HARVEST</span>'
        : `<span class="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-semibold mono-font">+${b.harvest_delay_minutes}M VARIANCE</span>`;
    } else {
      adherenceBadge = '<span class="px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 text-[10px] font-semibold mono-font">IN PROGRESS</span>';
    }

    return `
      <div class="bg-[#151c26] p-4 rounded-lg border border-[#1e2733] hover:border-[#334155] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center space-x-2">
            <span class="font-semibold text-slate-100 text-sm">${b.batch_name}</span>
            ${adherenceBadge}
          </div>
          <div class="text-slate-400 text-xs flex flex-wrap gap-x-4 gap-y-1">
            <span>Lead: <strong class="text-slate-200 font-medium">${b.scientist_name}</strong></span>
            <span>Strain: <span class="text-emerald-400 italic">${b.organism || 'S. cerevisiae'}</span></span>
            <span>Started: <span class="mono-font text-slate-300">${dateStr} · ${timeStr}</span></span>
            ${stopTimeStr ? `<span>Stopped: <span class="mono-font text-slate-300">${stopTimeStr}</span></span>` : ''}
            <span>Runtime: <strong class="text-sky-400 mono-font">${runtimeStr}</strong></span>
          </div>
          ${b.notes ? `<div class="text-[11px] text-slate-500 mt-0.5">${b.notes}</div>` : ''}
        </div>

        <div class="flex items-center space-x-3 shrink-0">
          <div class="text-right text-xs">
            <div class="text-emerald-400 font-bold mono-font">${b.peak_turbidity || 0} NTU</div>
            <div class="text-[10px] text-slate-500">Peak OD</div>
          </div>
          <button class="replay-batch-btn px-3 py-1.5 rounded bg-[#0f141b] hover:bg-[#1e2733] text-slate-100 border border-[#334155] text-xs font-medium transition-colors" data-id="${b.id}">
            Replay Batch &rarr;
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.replay-batch-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      viewingHistoricalBatchId = e.currentTarget.dataset.id;
      document.getElementById('historyModal')?.classList.add('hidden');
      await refreshDashboard();
    });
  });
}

function renderHistoricalBatch(details) {
  const batch = details.batch;
  const readings = details.readings || [];
  const analysis = details.analysis || {};

  const notice = document.getElementById('historicalArchiveNotice');
  const noticeText = document.getElementById('historicalNoticeText');
  if (notice) {
    notice.classList.remove('hidden');
    if (noticeText) {
      noticeText.innerHTML = `Inspecting archived run <strong>${batch.batch_name}</strong> (${batch.scientist_name}) · ${readings.length} readings loaded.`;
    }
  }

  updateActiveBatchBanner(batch);
  updatePredictionHero(analysis);
  updateMetricCards(analysis);
  updateLifecycleMilestones(analysis, batch);
  renderQuickBatchPills(cachedBatchesList);
  updateHistoryTable(readings);
  ChartsManager.updateCharts(readings, analysis, batch);
}

/**
 * Bioprocess Research Studio UI Controller
 * Manages Batch Lifecycle, Real-Time Ingestion, Stop/Harvest, and Historical Replay
 */

let refreshIntervalMs = 4000;
let refreshTimer = null;
let isRefreshing = false;

// State management
let currentActiveBatch = null;
let viewingHistoricalBatchId = null;
let lastHarvestRecommendedAt = null;
let cachedBatchesList = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize charts
  ChartsManager.initCharts();

  // Initial load
  await refreshDashboard();

  // Start polling
  startAutoRefresh();

  // Setup event listeners
  setupEventListeners();
});

function setupEventListeners() {
  // -------------------------------------------------------------
  // Manual & Auto-refresh
  // -------------------------------------------------------------
  const intervalSelect = document.getElementById('intervalSelect');
  if (intervalSelect) {
    intervalSelect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val === 0) {
        stopAutoRefresh();
      } else {
        refreshIntervalMs = val * 1000;
        startAutoRefresh();
      }
    });
  }

  // Simulation Phase Presets
  document.querySelectorAll('.phase-preset-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const phase = e.currentTarget.dataset.phase;
      btn.disabled = true;
      btn.innerText = 'Setting...';
      await Api.resetSimulation(phase);
      await refreshDashboard();
      btn.disabled = false;
      btn.innerText = phase.toUpperCase();
    });
  });

  // Advance simulation tick
  const tickBtn = document.getElementById('tickSimBtn');
  if (tickBtn) {
    tickBtn.addEventListener('click', async () => {
      tickBtn.disabled = true;
      await Api.tickSimulation();
      await refreshDashboard();
      tickBtn.disabled = false;
    });
  }

  // -------------------------------------------------------------
  // START REACTION MODAL
  // -------------------------------------------------------------
  const startModal = document.getElementById('startBatchModal');
  const openStartBtn = document.getElementById('openStartBatchModalBtn');
  const closeStartBtn = document.getElementById('closeStartBatchModalBtn');
  const cancelStartBtn = document.getElementById('cancelStartBatchBtn');
  const startForm = document.getElementById('startBatchForm');

  if (openStartBtn && startModal) {
    openStartBtn.addEventListener('click', () => {
      document.getElementById('startBatchError').classList.add('hidden');
      startModal.classList.remove('hidden');
    });
  }

  const closeStartModal = () => {
    if (startModal) startModal.classList.add('hidden');
  };
  if (closeStartBtn) closeStartBtn.addEventListener('click', closeStartModal);
  if (cancelStartBtn) cancelStartBtn.addEventListener('click', closeStartModal);

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
        errorDiv.innerText = 'Please provide both Reaction Name and Scientist Name.';
        errorDiv.classList.remove('hidden');
        return;
      }

      const res = await Api.startBatch({
        batch_name: batchName,
        scientist_name: scientistName,
        organism: organism,
        broth_type: brothType,
        notes: notes
      });

      if (res.success) {
        viewingHistoricalBatchId = null;
        lastHarvestRecommendedAt = null;
        closeStartModal();
        startForm.reset();
        await refreshDashboard();
      } else {
        errorDiv.innerText = res.error || 'Failed to start reaction.';
        errorDiv.classList.remove('hidden');
      }
    });
  }

  // -------------------------------------------------------------
  // STOP REACTION / HARVEST BUTTON
  // -------------------------------------------------------------
  const stopBtn = document.getElementById('stopBatchBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      if (!currentActiveBatch) {
        alert('No active reaction is currently running to stop.');
        return;
      }

      const confirmStop = confirm(
        `Are you sure you want to stop reaction "${currentActiveBatch.batch_name}"?\n` +
        `This will permanently lock the data, record the harvest timing, and save it to the history archive.`
      );
      if (!confirmStop) return;

      stopBtn.disabled = true;
      stopBtn.innerText = 'Stopping...';
      const res = await Api.stopBatch({
        harvest_recommended_at: lastHarvestRecommendedAt,
        reason: 'harvested'
      });
      stopBtn.disabled = false;
      stopBtn.innerHTML = '<span>🛑</span><span>Stop Reaction</span>';

      if (res.success) {
        alert(
          `✓ Reaction "${res.batch.batch_name}" completed!\n` +
          `Stopped at: ${new Date(res.batch.stopped_at).toLocaleTimeString()}\n` +
          `Adherence: ${res.batch.harvest_delay_minutes ? res.batch.harvest_delay_minutes + ' min delay' : 'Harvested on target'}.`
        );
        await refreshDashboard();
      } else {
        alert(res.error || 'Error stopping batch.');
      }
    });
  }

  // -------------------------------------------------------------
  // PAST BIOPROCESSES / HISTORY MODAL
  // -------------------------------------------------------------
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

  const closeHistory = () => {
    if (historyModal) historyModal.classList.add('hidden');
  };
  if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', closeHistory);
  if (closeHistoryBtn2) closeHistoryBtn2.addEventListener('click', closeHistory);

  // Exit Historical Replay Mode
  const exitReplayBtn = document.getElementById('exitReplayBtn');
  if (exitReplayBtn) {
    exitReplayBtn.addEventListener('click', async () => {
      viewingHistoricalBatchId = null;
      document.getElementById('historicalArchiveNotice').classList.add('hidden');
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
  if (closeModalBtn && settingsModal) {
    closeModalBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
  }

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
        statusDiv.innerHTML = `<span class="text-emerald-400">✓ ${res.message}</span>`;
        setTimeout(() => {
          settingsModal.classList.add('hidden');
          refreshDashboard();
        }, 1200);
      } else {
        statusDiv.innerHTML = `<span class="text-red-400">✗ ${res.error || 'Failed'}</span>`;
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
// MAIN DASHBOARD REFRESH LOGIC
// -------------------------------------------------------------
async function refreshDashboard() {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    // ---------------------------------------------------------
    // CASE A: Viewing a Historical Archived Batch (Replay Mode)
    // ---------------------------------------------------------
    if (viewingHistoricalBatchId) {
      const batchDetails = await Api.getBatchDetails(viewingHistoricalBatchId);
      if (batchDetails && batchDetails.batch) {
        renderHistoricalBatch(batchDetails);
      }
      return;
    }

    // ---------------------------------------------------------
    // CASE B: Live Reaction Monitoring
    // ---------------------------------------------------------
    document.getElementById('historicalArchiveNotice').classList.add('hidden');

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
    ChartsManager.updateCharts(history?.data || [], prediction);

    // Track when recommendation hits stationary
    if (prediction?.phase_code === 'stationary' && !lastHarvestRecommendedAt) {
      lastHarvestRecommendedAt = new Date().toISOString();
    }
  } catch (err) {
    console.error('Error refreshing dashboard:', err);
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
    if (nameEl) nameEl.innerText = 'No Active Reaction (Click "Start Reaction" to begin)';
    if (sciEl) sciEl.innerText = 'None';
    if (orgEl) orgEl.innerText = '--';
    if (startEl) startEl.innerText = '--';
    if (idEl) idEl.innerText = 'ID: None';
    if (badgeEl) {
      badgeEl.className = 'px-2 py-0.5 rounded bg-gray-700/50 text-gray-400 font-bold';
      badgeEl.innerText = 'IDLE';
    }
    return;
  }

  if (nameEl) nameEl.innerText = batch.batch_name;
  if (sciEl) sciEl.innerText = batch.scientist_name;
  if (orgEl) orgEl.innerText = batch.organism || 'S. cerevisiae';
  if (idEl) idEl.innerText = `ID: ${batch.id.substring(0, 8)}...`;

  if (startEl && batch.started_at) {
    const sDate = new Date(batch.started_at);
    startEl.innerText = `${sDate.toLocaleDateString([], {month:'short', day:'numeric'})} ${sDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  if (badgeEl) {
    if (batch.status === 'active') {
      badgeEl.className = 'px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold';
      badgeEl.innerText = '● LIVE INCUBATION';
    } else {
      badgeEl.className = 'px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold';
      badgeEl.innerText = 'COMPLETED';
    }
  }
}

function updateSystemStatusPill(statusInfo, dataSource) {
  const pill = document.getElementById('cloudStatusPill');
  const text = document.getElementById('cloudStatusText');
  const dot = document.getElementById('cloudStatusDot');
  if (!pill || !text || !dot) return;

  if (dataSource === 'supabase' && statusInfo?.is_supabase_configured) {
    pill.className = 'px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400';
    text.innerText = 'SUPABASE CLOUD LIVE';
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400 live-pulse';
  } else {
    pill.className = 'px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-2 bg-purple-500/10 border border-purple-500/30 text-purple-400';
    text.innerText = 'SIMULATION / TEST MODE';
    dot.className = 'w-2 h-2 rounded-full bg-purple-400 live-pulse';
  }
}

function updatePredictionHero(pred) {
  if (!pred) return;

  const statusBadge = document.getElementById('heroStatusBadge');
  const statusText = document.getElementById('heroStatusText');
  const peakText = document.getElementById('heroPeakText');
  const rateText = document.getElementById('heroRateText');
  const recoBox = document.getElementById('heroRecommendationBox');
  const recoText = document.getElementById('heroRecommendationText');
  const recoIcon = document.getElementById('heroRecommendationIcon');

  if (statusText) statusText.innerText = pred.current_status || 'Unknown';
  if (peakText) peakText.innerText = pred.estimated_peak || '--';
  if (rateText) rateText.innerText = pred.growth_rate_formatted || '--';
  if (recoText) recoText.innerText = pred.recommendation || '--';

  const phase = pred.phase_code || 'log';
  if (statusBadge) {
    statusBadge.className = `px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider badge-${phase}`;
  }

  if (recoBox) {
    if (phase === 'stationary') {
      recoBox.className = 'p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200';
      if (recoIcon) recoIcon.innerText = '⚠️';
    } else if (phase === 'log') {
      recoBox.className = 'p-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
      if (recoIcon) recoIcon.innerText = '🚀';
    } else if (phase === 'death') {
      recoBox.className = 'p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200';
      if (recoIcon) recoIcon.innerText = '🛑';
    } else {
      recoBox.className = 'p-4 rounded-xl border border-blue-500/40 bg-blue-500/10 text-blue-200';
      if (recoIcon) recoIcon.innerText = '⏳';
    }
  }

  const alertsContainer = document.getElementById('envAlertsContainer');
  if (alertsContainer) {
    if (pred.environmental_alerts && pred.environmental_alerts.length > 0) {
      alertsContainer.innerHTML = pred.environmental_alerts.map(a => `
        <div class="px-3 py-2 rounded-lg text-xs flex items-center space-x-2 ${a.type === 'danger' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
          <span>ℹ️</span>
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

  // Turbidity
  const turbVal = document.getElementById('metricTurbidity');
  const turbPeak = document.getElementById('metricTurbidityPeak');
  if (turbVal) turbVal.innerText = `${reading.turbidity} NTU`;
  if (turbPeak) turbPeak.innerText = `Peak: ${metrics.peak_turbidity || reading.turbidity} NTU`;

  // Temperature
  const tempVal = document.getElementById('metricTemp');
  const tempStatus = document.getElementById('metricTempStatus');
  if (tempVal) tempVal.innerText = `${reading.temperature} °C`;
  if (tempStatus) {
    if (reading.temperature >= 28.0 && reading.temperature <= 36.0) {
      tempStatus.innerHTML = '<span class="text-emerald-400">● Optimal (30-36°C)</span>';
    } else {
      tempStatus.innerHTML = '<span class="text-amber-400">▲ Suboptimal</span>';
    }
  }

  // pH
  const phVal = document.getElementById('metricPH');
  const phDelta = document.getElementById('metricPHDelta');
  if (phVal) phVal.innerText = `${reading.ph}`;
  if (phDelta) {
    const delta = (reading.ph - 7.0).toFixed(2);
    phDelta.innerText = `Shift: ${delta > 0 ? '+' : ''}${delta} from pH 7.0`;
  }

  // Headspace Gas (CO2 / VOC)
  const gasVal = document.getElementById('metricGas');
  const gasPeak = document.getElementById('metricGasPeak');
  if (gasVal) gasVal.innerText = `${reading.gas || 400} PPM`;
  if (gasPeak) gasPeak.innerText = `Peak: ${metrics.peak_gas || reading.gas || 400} PPM`;

  // Batch Duration
  const durVal = document.getElementById('metricDuration');
  const countVal = document.getElementById('metricReadingsCount');
  if (durVal) durVal.innerText = `${metrics.batch_duration_hours || 0.0} hrs`;
  if (countVal) countVal.innerText = `${metrics.total_readings || 0} samples logged`;
}

// -------------------------------------------------------------
// LIFECYCLE MILESTONES (WHEN START, LOG, PEAK, HARVEST, STOP, DECAY)
// -------------------------------------------------------------
function updateLifecycleMilestones(analysis, batch) {
  const ms = analysis?.phase_milestones || {};
  const metrics = analysis?.metrics || {};

  // Milestone 1: Inoculation Start
  const startEl = document.getElementById('msStartTime');
  const startTurbEl = document.getElementById('msStartTurb');
  const startPHEl = document.getElementById('msStartPH');

  if (ms.inoculation_start) {
    const sDate = new Date(ms.inoculation_start.timestamp);
    if (startEl) startEl.innerText = `${sDate.toLocaleDateString([], {month:'short', day:'numeric'})} ${sDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    if (startTurbEl) startTurbEl.innerText = `${ms.inoculation_start.turbidity} NTU`;
    if (startPHEl) startPHEl.innerText = `${ms.inoculation_start.ph}`;
  } else if (batch?.started_at) {
    const sDate = new Date(batch.started_at);
    if (startEl) startEl.innerText = `${sDate.toLocaleDateString([], {month:'short', day:'numeric'})} ${sDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    if (startTurbEl) startTurbEl.innerText = `105.0 NTU`;
    if (startPHEl) startPHEl.innerText = `7.05`;
  }

  // Milestone 2: Log Acceleration Surge
  const logTimeEl = document.getElementById('msLogTime');
  const logHrEl = document.getElementById('msLogTimeHr');
  const logTurbEl = document.getElementById('msLogTurb');

  if (ms.log_acceleration) {
    const lDate = new Date(ms.log_acceleration.timestamp);
    if (logTimeEl) logTimeEl.innerText = `${lDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    if (logHrEl) logHrEl.innerText = `t=${ms.log_acceleration.time_hr}h`;
    if (logTurbEl) logTurbEl.innerText = `${ms.log_acceleration.turbidity} NTU`;
  } else {
    if (logTimeEl) logTimeEl.innerText = analysis?.phase_code === 'lag' ? 'In Adaptation' : 'Early Log';
    if (logHrEl) logHrEl.innerText = 't=~1.5h';
    if (logTurbEl) logTurbEl.innerText = '--';
  }

  // Milestone 3: Peak Biomass
  const peakTimeEl = document.getElementById('msPeakTime');
  const peakHrEl = document.getElementById('msPeakTimeHr');
  const peakTurbEl = document.getElementById('msPeakTurb');

  if (ms.peak_biomass) {
    const pDate = new Date(ms.peak_biomass.timestamp);
    if (peakTimeEl) peakTimeEl.innerText = `${pDate.toLocaleDateString([], {month:'short', day:'numeric'})} ${pDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    if (peakHrEl) peakHrEl.innerText = `t=${ms.peak_biomass.time_hr}h`;
    if (peakTurbEl) peakTurbEl.innerText = `${ms.peak_biomass.turbidity} NTU`;
  } else if (batch?.peak_turbidity) {
    if (peakTimeEl) peakTimeEl.innerText = 'Recorded at Peak';
    if (peakHrEl) peakHrEl.innerText = 'Max Yield';
    if (peakTurbEl) peakTurbEl.innerText = `${batch.peak_turbidity} NTU`;
  } else {
    if (peakTimeEl) peakTimeEl.innerText = analysis?.estimated_peak || 'Estimating...';
    if (peakHrEl) peakHrEl.innerText = '--';
    if (peakTurbEl) peakTurbEl.innerText = `Proj: ${metrics.predicted_carrying_capacity_K || 795} NTU`;
  }

  // Milestone 4: Harvest Alert
  const recoTimeEl = document.getElementById('msRecoTime');
  const recoHrEl = document.getElementById('msRecoTimeHr');
  const peakGasEl = document.getElementById('msPeakGas');

  if (ms.harvest_window) {
    const rDate = new Date(ms.harvest_window.timestamp);
    if (recoTimeEl) recoTimeEl.innerText = rDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    if (recoHrEl) recoHrEl.innerText = `t=${ms.harvest_window.time_hr}h`;
  } else if (batch?.harvest_recommended_at) {
    const rDate = new Date(batch.harvest_recommended_at);
    if (recoTimeEl) recoTimeEl.innerText = rDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    if (recoHrEl) recoHrEl.innerText = 'Stationary Hit';
  } else {
    if (recoTimeEl) recoTimeEl.innerText = 'Pending Peak';
    if (recoHrEl) recoHrEl.innerText = 'Armed';
  }
  if (peakGasEl) peakGasEl.innerText = `${metrics.peak_gas || batch?.peak_gas || 400} PPM`;

  // Milestone 5: Action Stop / Harvest Adherence
  const stopTimeEl = document.getElementById('msStopTime');
  const stopAdhEl = document.getElementById('msStopAdherence');
  const adhTextEl = document.getElementById('msAdherenceText');

  if (batch?.stopped_at) {
    const stDate = new Date(batch.stopped_at);
    if (stopTimeEl) stopTimeEl.innerText = `${stDate.toLocaleDateString([], {month:'short', day:'numeric'})} ${stDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    
    if (batch.harvest_delay_minutes === 0 || batch.harvest_delay_minutes === null) {
      if (stopAdhEl) {
        stopAdhEl.innerText = '✓ On-Time';
        stopAdhEl.className = 'text-[10px] text-emerald-400 font-bold mono-font';
      }
      if (adhTextEl) adhTextEl.innerText = 'Harvested on target';
    } else {
      if (stopAdhEl) {
        stopAdhEl.innerText = `+${batch.harvest_delay_minutes}m`;
        stopAdhEl.className = 'text-[10px] text-amber-400 font-bold mono-font';
      }
      if (adhTextEl) adhTextEl.innerText = `${batch.harvest_delay_minutes} min post-peak`;
    }
  } else {
    if (stopTimeEl) stopTimeEl.innerText = 'Reaction In Progress';
    if (stopAdhEl) {
      stopAdhEl.innerText = 'Live';
      stopAdhEl.className = 'text-[10px] text-cyan-400 font-semibold mono-font';
    }
    if (adhTextEl) adhTextEl.innerText = 'Ready to Harvest';
  }

  // Milestone 6: Decay / Dying Phase
  const decayTimeEl = document.getElementById('msDecayTime');
  const decayPillEl = document.getElementById('msDecayStatusPill');
  const decayDetailEl = document.getElementById('msDecayDetail');

  if (ms.decline_death) {
    const dDate = new Date(ms.decline_death.timestamp);
    if (decayTimeEl) decayTimeEl.innerText = `${dDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} (t=${ms.decline_death.time_hr}h)`;
    if (decayPillEl) {
      decayPillEl.innerText = 'DECAY ACTIVE';
      decayPillEl.className = 'text-[10px] text-red-400 font-bold';
    }
    if (decayDetailEl) {
      decayDetailEl.innerText = `Lost -${ms.decline_death.loss_ntu} NTU`;
      decayDetailEl.className = 'text-red-300 font-semibold';
    }
  } else {
    if (batch?.status === 'completed') {
      if (decayTimeEl) decayTimeEl.innerText = 'Decay Prevented';
      if (decayPillEl) {
        decayPillEl.innerText = 'Preserved';
        decayPillEl.className = 'text-[10px] text-emerald-400 font-bold';
      }
      if (decayDetailEl) {
        decayDetailEl.innerText = 'Harvested prior to lysis';
        decayDetailEl.className = 'text-emerald-300';
      }
    } else {
      if (decayTimeEl) decayTimeEl.innerText = 'None Detected';
      if (decayPillEl) {
        decayPillEl.innerText = 'Viable';
        decayPillEl.className = 'text-[10px] text-emerald-400 font-semibold';
      }
      if (decayDetailEl) {
        decayDetailEl.innerText = 'High cell viability';
        decayDetailEl.className = 'text-gray-300';
      }
    }
  }

  // Section badge
  const mBadge = document.getElementById('milestoneBatchBadge');
  if (mBadge) {
    if (viewingHistoricalBatchId) {
      mBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30';
      mBadge.innerText = `Archive Replay: ${batch?.batch_name ? batch.batch_name.substring(0, 22) + '...' : 'Past Reaction'}`;
    } else {
      mBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      mBadge.innerText = 'Active Reaction Live';
    }
  }
}

// -------------------------------------------------------------
// HORIZONTAL PAST REACTIONS QUICK-PICKER CAROUSEL
// -------------------------------------------------------------
function renderQuickBatchPills(batches = []) {
  const container = document.getElementById('quickBatchPillsContainer');
  if (!container) return;

  const isLiveActive = !viewingHistoricalBatchId;

  let html = `
    <button class="quick-pill-btn px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center space-x-1.5 ${isLiveActive ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/20' : 'bg-gray-800/80 text-gray-300 hover:bg-gray-700 border border-white/5'}" data-action="live">
      <span class="w-2 h-2 rounded-full ${isLiveActive ? 'bg-black' : 'bg-emerald-400'}"></span>
      <span>● Live Active</span>
    </button>
  `;

  batches.forEach(b => {
    const isSelected = viewingHistoricalBatchId === b.id;
    const shortName = b.batch_name.length > 20 ? b.batch_name.substring(0, 18) + '...' : b.batch_name;
    const isCompleted = b.status === 'completed';

    html += `
      <button class="quick-pill-btn px-2.5 py-1 rounded-lg text-xs font-semibold transition-all shrink-0 flex items-center space-x-1.5 ${isSelected ? 'bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20' : 'bg-gray-800/80 text-gray-300 hover:bg-gray-700 border border-white/5'}" data-id="${b.id}">
        <span class="w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-blue-400' : 'bg-cyan-400'}"></span>
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
        document.getElementById('historicalArchiveNotice').classList.add('hidden');
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
    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-gray-500">No telemetry packets recorded yet.</td></tr>';
    return;
  }

  const recent = [...data].reverse().slice(0, 8);
  tbody.innerHTML = recent.map((r) => {
    const timeStr = new Date(r.created_at).toLocaleTimeString();
    return `
      <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors text-xs">
        <td class="py-2.5 px-3 text-gray-400 mono-font">${timeStr}</td>
        <td class="py-2.5 px-3 font-semibold text-emerald-400 mono-font">${r.turbidity} NTU</td>
        <td class="py-2.5 px-3 text-orange-300 mono-font">${r.temperature} °C</td>
        <td class="py-2.5 px-3 text-purple-300 mono-font">${r.ph}</td>
        <td class="py-2.5 px-3 text-cyan-300 mono-font">${r.gas ? r.gas + ' PPM' : '400 PPM'}</td>
        <td class="py-2.5 px-3 text-gray-400">${r.device_id || 'ESP32'}</td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// PAST BIOPROCESSES MODAL & HISTORICAL REPLAY
// -------------------------------------------------------------
async function loadPastBatchesList() {
  const container = document.getElementById('batchesListContainer');
  if (!container) return;

  container.innerHTML = '<div class="text-center py-6 text-cyan-400">Fetching past bioprocess records...</div>';
  const res = await Api.getBatches(20);
  const batches = res?.data || [];

  if (batches.length === 0) {
    container.innerHTML = '<div class="text-center py-6 text-gray-500">No past experiments recorded yet.</div>';
    return;
  }

  container.innerHTML = batches.map(b => {
    const sDate = new Date(b.started_at || b.created_at);
    const dateStr = sDate.toLocaleDateString();
    const timeStr = sDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isCompleted = b.status === 'completed';

    let adherenceBadge = '';
    if (isCompleted) {
      if (b.harvest_delay_minutes === 0 || b.harvest_delay_minutes === null) {
        adherenceBadge = '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold">✓ On-Time Harvest</span>';
      } else {
        adherenceBadge = `<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">+${b.harvest_delay_minutes}m Delay</span>`;
      }
    } else {
      adherenceBadge = '<span class="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-semibold">● In Progress</span>';
    }

    return `
      <div class="glass-panel p-4 rounded-xl border border-white/10 hover:border-cyan-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-white text-sm">${b.batch_name}</span>
            ${adherenceBadge}
          </div>
          <div class="text-gray-400 text-xs flex flex-wrap gap-x-4">
            <span>Scientist: <strong class="text-gray-300">${b.scientist_name}</strong></span>
            <span>Organism: <strong class="text-emerald-400">${b.organism || 'S. cerevisiae'}</strong></span>
            <span>Started: <span class="mono-font text-gray-400">${dateStr} ${timeStr}</span></span>
          </div>
          ${b.notes ? `<div class="text-[11px] text-gray-500 italic mt-0.5">"${b.notes}"</div>` : ''}
        </div>

        <div class="flex items-center space-x-3 shrink-0">
          <div class="text-right text-xs">
            <div class="text-emerald-400 font-bold mono-font">${b.peak_turbidity || 0} NTU</div>
            <div class="text-[10px] text-gray-500">Peak Biomass</div>
          </div>
          <button class="replay-batch-btn px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all" data-id="${b.id}">
            Inspect & Replay →
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.replay-batch-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const batchId = e.currentTarget.dataset.id;
      viewingHistoricalBatchId = batchId;
      document.getElementById('historyModal').classList.add('hidden');
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
      noticeText.innerHTML = `Viewing historical archive of <strong>${batch.batch_name}</strong> (Inoculated by <em>${batch.scientist_name}</em>). Total readings stored: ${readings.length}.`;
    }
  }

  updateActiveBatchBanner(batch);
  updatePredictionHero(analysis);
  updateMetricCards(analysis);
  updateLifecycleMilestones(analysis, batch);
  renderQuickBatchPills(cachedBatchesList);
  updateHistoryTable(readings);
  ChartsManager.updateCharts(readings, analysis);
}

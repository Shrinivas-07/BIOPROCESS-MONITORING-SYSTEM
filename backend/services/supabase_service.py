import uuid
from datetime import datetime, timedelta
import requests
from backend.config import Config
from backend.services.simulator import BioprocessSimulator

class SupabaseService:
    def __init__(self):
        self.url = Config.SUPABASE_URL
        self.key = Config.SUPABASE_KEY
        self.table = Config.SUPABASE_TABLE
        self.batches_table = Config.SUPABASE_BATCHES_TABLE

        # -----------------------------------------------------------------
        # In-Memory Multi-Batch Storage (Full offline simulation capability)
        # -----------------------------------------------------------------
        self._batches = {}
        self._batch_readings = {} # batch_id -> list of readings
        self._active_batch_id = None

        self._seed_in_memory_batches()

    def _seed_in_memory_batches() -> None:
        pass

    def _seed_in_memory_batches(self):
        """Pre-seeds 2 completed historical runs + 1 active run for immediate demonstration."""
        now = datetime.utcnow()

        # Batch 1: Completed stationary yeast run (yesterday)
        b1_id = str(uuid.uuid4())
        b1_start = now - timedelta(hours=28)
        b1_reco = b1_start + timedelta(hours=7, minutes=45)
        b1_stop = b1_start + timedelta(hours=8)
        b1_readings = BioprocessSimulator.generate_batch_history(hours=8.0, step_minutes=15, target_phase="stationary")
        for r in b1_readings:
            r["batch_id"] = b1_id

        self._batches[b1_id] = {
            "id": b1_id,
            "batch_name": "S. cerevisiae High-Gravity Fermentation",
            "scientist_name": "Dr. Sarah Lin (Bio-Team Alpha)",
            "organism": "Saccharomyces cerevisiae (ATCC 9763)",
            "broth_type": "YPD Broth + 5% Dextrose",
            "notes": "Testing high-density cell growth with optical sensor feedback. Harvested precisely at stationary peak.",
            "status": "completed",
            "started_at": b1_start.isoformat() + "Z",
            "harvest_recommended_at": b1_reco.isoformat() + "Z",
            "stopped_at": b1_stop.isoformat() + "Z",
            "harvest_delay_minutes": 15.0,
            "peak_turbidity": 792.4,
            "peak_gas": 2894.0,
            "created_at": b1_start.isoformat() + "Z"
        }
        self._batch_readings[b1_id] = b1_readings

        # Batch 2: Completed log-phase protein expression run (2 days ago)
        b2_id = str(uuid.uuid4())
        b2_start = now - timedelta(hours=50)
        b2_stop = b2_start + timedelta(hours=4, minutes=30)
        b2_readings = BioprocessSimulator.generate_batch_history(hours=4.5, step_minutes=15, target_phase="log")
        for r in b2_readings:
            r["batch_id"] = b2_id

        self._batches[b2_id] = {
            "id": b2_id,
            "batch_name": "E. coli Recombinant Protein Induction",
            "scientist_name": "Student Lab Group 2",
            "organism": "Escherichia coli (BL21)",
            "broth_type": "Luria-Bertani (LB) Medium",
            "notes": "Induction at mid-log phase OD ~500 NTU using IPTG analog.",
            "status": "completed",
            "started_at": b2_start.isoformat() + "Z",
            "harvest_recommended_at": b2_stop.isoformat() + "Z",
            "stopped_at": b2_stop.isoformat() + "Z",
            "harvest_delay_minutes": 0.0,
            "peak_turbidity": 498.0,
            "peak_gas": 2150.0,
            "created_at": b2_start.isoformat() + "Z"
        }
        self._batch_readings[b2_id] = b2_readings

        # Batch 3: Currently ACTIVE real-time reaction
        b3_id = str(uuid.uuid4())
        b3_start = now - timedelta(hours=6, minutes=30)
        b3_readings = BioprocessSimulator.generate_batch_history(hours=6.5, step_minutes=15, target_phase="log")
        for r in b3_readings:
            r["batch_id"] = b3_id

        self._batches[b3_id] = {
            "id": b3_id,
            "batch_name": "Live Bioprocess Reactor Run #03",
            "scientist_name": "Lead Researcher / IDEA Lab",
            "organism": "Saccharomyces cerevisiae",
            "broth_type": "Standard YPD Nutrient Broth",
            "notes": "Actively monitored real-time incubation run. Continuous optical & headspace gas tracking.",
            "status": "active",
            "started_at": b3_start.isoformat() + "Z",
            "harvest_recommended_at": None,
            "stopped_at": None,
            "harvest_delay_minutes": None,
            "peak_turbidity": 680.5,
            "peak_gas": 2620.0,
            "created_at": b3_start.isoformat() + "Z"
        }
        self._batch_readings[b3_id] = b3_readings
        self._active_batch_id = b3_id

    @property
    def is_configured(self) -> bool:
        return Config.is_supabase_configured()

    def _get_headers(self):
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }

    def test_connection(self):
        """Tests whether Supabase tables exist and are accessible."""
        if not self.is_configured:
            return {"status": "unconfigured", "message": "Supabase credentials not configured in .env or settings."}
        
        endpoint = f"{self.url}/rest/v1/{self.table}?limit=1"
        try:
            res = requests.get(endpoint, headers=self._get_headers(), timeout=5)
            if res.status_code == 200:
                return {"status": "connected", "message": f"Successfully connected to Supabase table '{self.table}'."}
            else:
                return {
                    "status": "error", 
                    "code": res.status_code, 
                    "message": f"Supabase returned HTTP {res.status_code}: {res.text}"
                }
        except Exception as e:
            return {"status": "error", "message": f"Connection failed: {str(e)}"}

    # -------------------------------------------------------------
    # BATCH LIFECYCLE MANAGEMENT (Start, Stop, List, Replay)
    # -------------------------------------------------------------
    def get_active_batch(self):
        """Returns the currently active batch metadata or None."""
        if self.is_configured:
            endpoint = f"{self.url}/rest/v1/{self.batches_table}?status=eq.active&order=created_at.desc&limit=1"
            try:
                res = requests.get(endpoint, headers=self._get_headers(), timeout=5)
                if res.status_code == 200:
                    data = res.json()
                    if data:
                        return data[0], "supabase"
            except Exception as e:
                print(f"[SupabaseService] Error fetching active batch: {e}")

        # Local fallback
        if self._active_batch_id and self._active_batch_id in self._batches:
            active_b = self._batches[self._active_batch_id]
            if active_b.get("status") == "active":
                return active_b, "local_simulation"
        return None, "local_simulation"

    def create_batch(self, batch_name, scientist_name, organism=None, broth_type=None, notes=None):
        """
        Marks any currently active batch as completed and creates a fresh new reaction batch.
        """
        now_iso = datetime.utcnow().isoformat() + "Z"
        organism = organism or "Saccharomyces cerevisiae"
        broth_type = broth_type or "YPD Nutrient Broth"
        notes = notes or ""

        # 1. First, stop existing active batch if any
        self.stop_active_batch(reason="auto_closed_new_batch")

        new_batch_id = str(uuid.uuid4())
        batch_payload = {
            "id": new_batch_id,
            "batch_name": batch_name,
            "scientist_name": scientist_name,
            "organism": organism,
            "broth_type": broth_type,
            "notes": notes,
            "status": "active",
            "started_at": now_iso,
            "peak_turbidity": 0.0,
            "peak_gas": 400.0,
            "created_at": now_iso
        }

        # Save to Supabase if configured
        if self.is_configured:
            endpoint = f"{self.url}/rest/v1/{self.batches_table}"
            try:
                res = requests.post(endpoint, headers=self._get_headers(), json=batch_payload, timeout=5)
                if res.status_code in (200, 201):
                    data = res.json()
                    if data:
                        batch_payload = data[0]
            except Exception as e:
                print(f"[SupabaseService] Create batch Supabase error: {e}")

        # Always track in local storage
        self._batches[new_batch_id] = batch_payload
        self._batch_readings[new_batch_id] = []
        self._active_batch_id = new_batch_id

        return batch_payload

    def stop_active_batch(self, harvest_recommended_at=None, reason="harvested"):
        """
        Stops the currently active batch, logs the stop time and calculates harvest delay.
        """
        active_batch, _ = self.get_active_batch()
        if not active_batch:
            return None

        batch_id = active_batch.get("id")
        now_dt = datetime.utcnow()
        now_iso = now_dt.isoformat() + "Z"

        # Calculate harvest delay adherence
        delay_minutes = 0.0
        if harvest_recommended_at:
            try:
                reco_dt = datetime.fromisoformat(harvest_recommended_at.replace("Z", "+00:00"))
                delay_minutes = max(0.0, round((now_dt - reco_dt.replace(tzinfo=None)).total_seconds() / 60.0, 1))
            except Exception:
                delay_minutes = 0.0

        # Calculate peak turbidity & gas for this batch
        readings, _ = self.get_recent_readings(limit=1000, batch_id=batch_id)
        peak_turb = max([float(r.get("turbidity", 0.0)) for r in readings], default=0.0)
        peak_gas = max([float(r.get("gas", 400.0)) for r in readings], default=400.0)

        update_payload = {
            "status": "completed",
            "stopped_at": now_iso,
            "harvest_recommended_at": harvest_recommended_at,
            "harvest_delay_minutes": delay_minutes,
            "peak_turbidity": peak_turb,
            "peak_gas": peak_gas
        }

        if self.is_configured:
            endpoint = f"{self.url}/rest/v1/{self.batches_table}?id=eq.{batch_id}"
            try:
                requests.patch(endpoint, headers=self._get_headers(), json=update_payload, timeout=5)
            except Exception as e:
                print(f"[SupabaseService] Stop batch patch error: {e}")

        # Update local
        if batch_id in self._batches:
            self._batches[batch_id].update(update_payload)
            active_batch = self._batches[batch_id]

        if self._active_batch_id == batch_id:
            self._active_batch_id = None

        return active_batch

    def list_batches(self, limit=10):
        """Returns past batches sorted newest first."""
        if self.is_configured:
            endpoint = f"{self.url}/rest/v1/{self.batches_table}?order=created_at.desc&limit={limit}"
            try:
                res = requests.get(endpoint, headers=self._get_headers(), timeout=5)
                if res.status_code == 200:
                    data = res.json()
                    if data:
                        return data, "supabase"
            except Exception as e:
                print(f"[SupabaseService] Query batches error: {e}")

        # Local fallback
        batch_list = sorted(self._batches.values(), key=lambda b: b.get("created_at", ""), reverse=True)
        return batch_list[:limit], "local_simulation"

    def get_batch_details(self, batch_id):
        """Returns batch metadata and its specific time-series telemetry."""
        # 1. Fetch metadata
        batch_meta = None
        if self.is_configured:
            endpoint = f"{self.url}/rest/v1/{self.batches_table}?id=eq.{batch_id}&limit=1"
            try:
                res = requests.get(endpoint, headers=self._get_headers(), timeout=5)
                if res.status_code == 200:
                    d = res.json()
                    if d:
                        batch_meta = d[0]
            except Exception:
                pass

        if not batch_meta:
            batch_meta = self._batches.get(batch_id)

        if not batch_meta:
            return None, []

        # 2. Fetch readings for this batch
        readings, source = self.get_recent_readings(limit=1000, batch_id=batch_id)
        return batch_meta, readings

    # -------------------------------------------------------------
    # TELEMETRY READINGS
    # -------------------------------------------------------------
    def get_recent_readings(self, limit=100, batch_id=None):
        """
        Returns readings chronologically (oldest -> newest).
        If batch_id is passed, filters strictly for that reaction.
        """
        # Determine target batch
        target_batch_id = batch_id
        if not target_batch_id and self._active_batch_id:
            target_batch_id = self._active_batch_id

        if self.is_configured:
            if target_batch_id:
                endpoint = f"{self.url}/rest/v1/{self.table}?batch_id=eq.{target_batch_id}&order=created_at.desc&limit={limit}"
            else:
                endpoint = f"{self.url}/rest/v1/{self.table}?order=created_at.desc&limit={limit}"

            try:
                res = requests.get(endpoint, headers=self._get_headers(), timeout=5)
                if res.status_code == 200:
                    data = res.json()
                    if data:
                        return list(reversed(data)), "supabase"
            except Exception as e:
                print(f"[SupabaseService] Query readings error: {e}")

        # Local fallback
        if target_batch_id and target_batch_id in self._batch_readings:
            buf = self._batch_readings[target_batch_id]
            return buf[-limit:], "local_simulation"

        # Global buffer fallback
        if self._active_batch_id and self._active_batch_id in self._batch_readings:
            return self._batch_readings[self._active_batch_id][-limit:], "local_simulation"

        return [], "local_simulation"

    def get_latest_reading(self, batch_id=None):
        readings, source = self.get_recent_readings(limit=1, batch_id=batch_id)
        if readings:
            return readings[-1], source
        return None, source

    def insert_reading(self, reading_data):
        """
        Inserts reading into Supabase and updates local batch buffer.
        Automatically tags reading with the current active batch_id!
        """
        # Attach active batch_id
        active_batch, _ = self.get_active_batch()
        if active_batch and "id" in active_batch:
            reading_data["batch_id"] = active_batch["id"]
        elif self._active_batch_id:
            reading_data["batch_id"] = self._active_batch_id

        inserted_cloud = False
        if self.is_configured:
            endpoint = f"{self.url}/rest/v1/{self.table}"
            try:
                res = requests.post(endpoint, headers=self._get_headers(), json=reading_data, timeout=5)
                if res.status_code in (200, 201):
                    inserted_cloud = True
            except Exception as e:
                print(f"[SupabaseService] Reading insert error: {e}")

        # Append to active batch in memory
        curr_b_id = reading_data.get("batch_id") or self._active_batch_id
        if curr_b_id:
            if curr_b_id not in self._batch_readings:
                self._batch_readings[curr_b_id] = []
            self._batch_readings[curr_b_id].append(reading_data)
            if len(self._batch_readings[curr_b_id]) > 1000:
                self._batch_readings[curr_b_id] = self._batch_readings[curr_b_id][-1000:]

        return {"success": True, "saved_to_cloud": inserted_cloud, "batch_id": curr_b_id}

    def reset_with_simulation(self, target_phase="stationary"):
        """Resets active batch with synthetic telemetry up to target_phase."""
        if not self._active_batch_id:
            self.create_batch("Demo Interactive Bioprocess", "Lab Evaluator", notes="Simulated demo batch")

        sim_data = BioprocessSimulator.generate_batch_history(hours=8.0, step_minutes=15, target_phase=target_phase)
        for r in sim_data:
            r["batch_id"] = self._active_batch_id

        self._batch_readings[self._active_batch_id] = sim_data
        return len(sim_data)

    def advance_live_simulation(self):
        """Simulates next step for active batch."""
        if not self._active_batch_id:
            self.create_batch("Live Microbial Incubation", "Automated Runner")

        cur_readings = self._batch_readings.get(self._active_batch_id, [])
        last = cur_readings[-1] if cur_readings else None
        next_reading = BioprocessSimulator.generate_next_live_reading(last)
        self.insert_reading(next_reading)
        return next_reading

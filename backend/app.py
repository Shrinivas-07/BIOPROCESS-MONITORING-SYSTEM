import os
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from backend.config import Config
from backend.services.growth_engine import GrowthEngine
from backend.services.supabase_service import SupabaseService

# Determine paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR)
CORS(app)

supabase_service = SupabaseService()

# -------------------------------------------------------------
# Static Frontend Serving
# -------------------------------------------------------------
@app.route("/")
def serve_landing():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/research")
def serve_research():
    return send_from_directory(FRONTEND_DIR, "research.html")

@app.route("/<path:path>")
def serve_static(path):
    if os.path.exists(os.path.join(FRONTEND_DIR, path)):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, "index.html")

# -------------------------------------------------------------
# System Status & Health API
# -------------------------------------------------------------
@app.route("/api/status", methods=["GET"])
def get_status():
    conn_info = supabase_service.test_connection()
    active_batch, _ = supabase_service.get_active_batch()
    return jsonify({
        "status": "online",
        "app_name": "Bioprocess Monitoring & Growth Prediction System",
        "supabase": conn_info,
        "is_supabase_configured": supabase_service.is_configured,
        "active_batch": active_batch
    })

# -------------------------------------------------------------
# BATCH & EXPERIMENT LIFECYCLE MANAGEMENT
# -------------------------------------------------------------
@app.route("/api/batches", methods=["GET"])
def get_batches():
    limit = request.args.get("limit", default=10, type=int)
    batches, source = supabase_service.list_batches(limit=limit)
    return jsonify({
        "count": len(batches),
        "source": source,
        "data": batches
    })

@app.route("/api/batches/active", methods=["GET"])
def get_active_batch():
    batch, source = supabase_service.get_active_batch()
    return jsonify({
        "active": bool(batch),
        "source": source,
        "data": batch
    })

@app.route("/api/batches/start", methods=["POST"])
def start_batch():
    """
    Starts a new bioprocess reaction.
    Mandatory fields: batch_name, scientist_name
    Optional: organism, broth_type, notes
    """
    payload = request.get_json(force=True, silent=True) or {}
    batch_name = payload.get("batch_name", "").strip()
    scientist_name = payload.get("scientist_name", "").strip()

    if not batch_name or not scientist_name:
        return jsonify({"error": "Both 'Reaction / Batch Name' and 'Scientist Name' are mandatory."}), 400

    organism = payload.get("organism", "Saccharomyces cerevisiae").strip()
    broth_type = payload.get("broth_type", "YPD Nutrient Broth").strip()
    notes = payload.get("notes", "").strip()

    new_batch = supabase_service.create_batch(
        batch_name=batch_name,
        scientist_name=scientist_name,
        organism=organism,
        broth_type=broth_type,
        notes=notes
    )
    return jsonify({
        "success": True,
        "message": f"Reaction '{batch_name}' started successfully.",
        "batch": new_batch
    }), 201

@app.route("/api/batches/stop", methods=["POST"])
def stop_batch():
    """
    Stops the active bioprocess reaction, locks historical readings,
    and calculates adherence against recommended harvest timing.
    """
    payload = request.get_json(force=True, silent=True) or {}
    harvest_reco_at = payload.get("harvest_recommended_at")
    reason = payload.get("reason", "harvested")

    stopped_batch = supabase_service.stop_active_batch(
        harvest_recommended_at=harvest_reco_at,
        reason=reason
    )
    if not stopped_batch:
        return jsonify({"error": "No active reaction found to stop."}), 404

    return jsonify({
        "success": True,
        "message": f"Reaction '{stopped_batch.get('batch_name')}' completed and saved to history.",
        "batch": stopped_batch
    })

@app.route("/api/batches/<batch_id>", methods=["GET"])
def get_batch_details(batch_id):
    """
    Retrieves a past experiment's full metadata and time-series telemetry for replay.
    """
    batch_meta, readings = supabase_service.get_batch_details(batch_id)
    if not batch_meta:
        return jsonify({"error": f"Batch with id '{batch_id}' not found."}), 404

    analysis = GrowthEngine.analyze(readings) if readings else GrowthEngine._empty_response()
    return jsonify({
        "batch": batch_meta,
        "readings_count": len(readings),
        "readings": readings,
        "analysis": analysis
    })

# -------------------------------------------------------------
# TELEMETRY & PREDICTION APIS
# -------------------------------------------------------------
@app.route("/api/telemetry/latest", methods=["GET"])
def get_latest_telemetry():
    batch_id = request.args.get("batch_id")
    reading, source = supabase_service.get_latest_reading(batch_id=batch_id)
    return jsonify({
        "data": reading,
        "source": source
    })

@app.route("/api/telemetry/history", methods=["GET"])
def get_history():
    limit = request.args.get("limit", default=100, type=int)
    batch_id = request.args.get("batch_id")
    readings, source = supabase_service.get_recent_readings(limit=limit, batch_id=batch_id)
    return jsonify({
        "count": len(readings),
        "source": source,
        "data": readings
    })

@app.route("/api/analytics/predict", methods=["GET"])
def get_prediction():
    limit = request.args.get("limit", default=100, type=int)
    batch_id = request.args.get("batch_id")
    readings, source = supabase_service.get_recent_readings(limit=limit, batch_id=batch_id)
    analysis = GrowthEngine.analyze(readings)
    analysis["data_source"] = source
    active_batch, _ = supabase_service.get_active_batch()
    analysis["active_batch"] = active_batch
    return jsonify(analysis)

@app.route("/api/telemetry", methods=["POST"])
def ingest_telemetry():
    """
    Accepts incoming sensor readings from ESP32 or test client.
    Payload format: {"turbidity": 792.0, "temperature": 30.3, "ph": 5.9, "gas": 2800.0, "device_id": "ESP32_BIO_01"}
    """
    payload = request.get_json(force=True, silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON payload"}), 400

    required_fields = ["turbidity", "temperature", "ph"]
    for field in required_fields:
        if field not in payload:
            return jsonify({"error": f"Missing required field: '{field}'"}), 400

    # Ensure gas has a valid reading or default baseline (400 PPM)
    if "gas" not in payload:
        payload["gas"] = 400.0
    else:
        try:
            payload["gas"] = float(payload["gas"])
        except (ValueError, TypeError):
            payload["gas"] = 400.0

    res = supabase_service.insert_reading(payload)
    return jsonify(res), 201

# -------------------------------------------------------------
# Simulation & Demo Controls (For Class Presentations)
# -------------------------------------------------------------
@app.route("/api/simulation/reset", methods=["POST"])
def reset_simulation():
    body = request.get_json(silent=True) or {}
    target_phase = body.get("phase", "stationary")
    count = supabase_service.reset_with_simulation(target_phase=target_phase)
    return jsonify({
        "message": f"Simulated batch reset to '{target_phase}' phase successfully.",
        "readings_count": count
    })

@app.route("/api/simulation/tick", methods=["POST"])
def tick_simulation():
    next_point = supabase_service.advance_live_simulation()
    return jsonify({
        "message": "New simulated live telemetry point generated.",
        "reading": next_point
    })

@app.route("/api/config/supabase", methods=["POST"])
def update_supabase_config():
    body = request.get_json(silent=True) or {}
    url = body.get("supabase_url", "").strip()
    key = body.get("supabase_key", "").strip()
    table = body.get("supabase_table", "bioprocess_readings").strip()

    if url and key:
        Config.SUPABASE_URL = url
        Config.SUPABASE_KEY = key
        Config.SUPABASE_TABLE = table
        supabase_service.url = url
        supabase_service.key = key
        supabase_service.table = table
        
        test = supabase_service.test_connection()
        return jsonify({
            "success": True,
            "message": "Supabase configuration updated.",
            "test_result": test
        })
    return jsonify({"error": "Both supabase_url and supabase_key are required"}), 400

# -------------------------------------------------------------
# App Runner
# -------------------------------------------------------------
if __name__ == "__main__":
    print(f"Starting Bioprocess Server on http://{Config.HOST}:{Config.PORT}")
    app.run(host=Config.HOST, port=Config.PORT, debug=False, use_reloader=False)

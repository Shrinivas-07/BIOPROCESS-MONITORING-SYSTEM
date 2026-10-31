#!/usr/bin/env python3
"""
Single-command launcher for the Bioprocess Lab Monitor & Growth Predictor
Usage:
    python run.py
"""

import os
import sys
import webbrowser
from backend.config import Config
from backend.app import app

def main():
    port = Config.PORT
    host = Config.HOST
    url = f"http://localhost:{port}"

    print("=" * 70)
    print(" [*] BIOPROCESS MONITORING & GROWTH PREDICTION SYSTEM")
    print("     AICTE IDEA Lab 1st Semester Student Project")
    print("=" * 70)
    print(f" * Server running on: {url}")
    print(f" * Supabase configured: {Config.is_supabase_configured()}")
    if not Config.is_supabase_configured():
        print(" * Running in local simulation mode (Full features active)")
        print(" * To connect your Supabase project, edit .env or use the Web UI modal")
    print("=" * 70)

    # Automatically open default browser if running locally
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        try:
            webbrowser.open(url)
        except Exception:
            pass

    app.run(host=host, port=port, debug=False, use_reloader=False)

if __name__ == "__main__":
    main()


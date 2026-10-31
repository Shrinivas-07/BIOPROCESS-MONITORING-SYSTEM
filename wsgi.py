"""
WSGI Entry Point for Production Cloud Deployment (Render, Railway, Heroku)
"""
import os
import sys

# Ensure root directory is on Python path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from backend.app import app

if __name__ == "__main__":
    from backend.config import Config
    app.run(host=Config.HOST, port=Config.PORT)


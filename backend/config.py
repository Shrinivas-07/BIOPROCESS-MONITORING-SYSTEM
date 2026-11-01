import os
from dotenv import load_dotenv

# Load .env file from project root or backend directory
load_dotenv()

class Config:
    PORT = int(os.getenv("PORT", 5000))
    HOST = os.getenv("HOST", "0.0.0.0")
    DEBUG = os.getenv("DEBUG", "True").lower() in ("true", "1", "yes")

    # Supabase Configuration - automatically strips any trailing slashes or /rest/v1
    _raw_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    if _raw_url.endswith("/rest/v1"):
        _raw_url = _raw_url[:-8].rstrip("/")
    SUPABASE_URL = _raw_url
    SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
    SUPABASE_TABLE = os.getenv("SUPABASE_TABLE", "bioprocess_readings").strip()
    SUPABASE_BATCHES_TABLE = os.getenv("SUPABASE_BATCHES_TABLE", "bioprocess_batches").strip()

    # Auto-enable fallback simulation if Supabase credentials are missing
    AUTO_SIMULATION = os.getenv("AUTO_SIMULATION", "True").lower() in ("true", "1", "yes")

    @classmethod
    def is_supabase_configured(cls) -> bool:
        return bool(cls.SUPABASE_URL and cls.SUPABASE_KEY and "supabase.co" in cls.SUPABASE_URL)


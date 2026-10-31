import os
from dotenv import load_dotenv

# Load .env file from project root or backend directory
load_dotenv()

class Config:
    PORT = int(os.getenv("PORT", 5000))
    HOST = os.getenv("HOST", "0.0.0.0")
    DEBUG = os.getenv("DEBUG", "True").lower() in ("true", "1", "yes")

    # Supabase Configuration
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
    SUPABASE_TABLE = os.getenv("SUPABASE_TABLE", "bioprocess_readings")
    SUPABASE_BATCHES_TABLE = os.getenv("SUPABASE_BATCHES_TABLE", "bioprocess_batches")

    # Auto-enable fallback simulation if Supabase credentials are missing
    AUTO_SIMULATION = os.getenv("AUTO_SIMULATION", "True").lower() in ("true", "1", "yes")

    @classmethod
    def is_supabase_configured(cls) -> bool:
        return bool(cls.SUPABASE_URL and cls.SUPABASE_KEY and "supabase.co" in cls.SUPABASE_URL)


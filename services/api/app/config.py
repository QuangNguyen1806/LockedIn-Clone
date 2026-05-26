from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = API_ROOT / "lockedin.db"
DEFAULT_UPLOAD_DIR = API_ROOT / "storage" / "uploads"


def resolve_storage_path(stored_path: str) -> Path:
    path = Path(stored_path)
    if path.is_absolute():
        return path
    return (API_ROOT / path).resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[".env", "../../.env"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = f"sqlite+aiosqlite:///{DEFAULT_DB_PATH}"
    database_url_sync: str = f"sqlite:///{DEFAULT_DB_PATH}"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = (
        "http://localhost:3000,http://localhost:1420,"
        "tauri://localhost,https://tauri.localhost,http://tauri.localhost"
    )
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash-lite"
    gemini_stt_model: str = "gemini-2.0-flash"
    llm_provider: str = "auto"
    stt_provider: str = "auto"
    deepgram_api_key: str = ""
    use_mock_ai: bool = True
    upload_dir: str = str(DEFAULT_UPLOAD_DIR)
    max_upload_mb: int = 10
    redis_url: str = "redis://localhost:6379/0"
    log_level: str = "INFO"
    sentry_dsn: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def active_llm_provider(self) -> str:
        if self.llm_provider != "auto":
            return self.llm_provider
        if self.gemini_api_key:
            return "gemini"
        if self.openai_api_key:
            return "openai"
        return "mock"

    @property
    def active_stt_provider(self) -> str:
        if self.stt_provider != "auto":
            return self.stt_provider
        if self.deepgram_api_key:
            return "deepgram"
        if self.gemini_api_key and not self.use_mock_ai:
            return "gemini"
        return "mock"


settings = Settings()

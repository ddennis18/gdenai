from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    llm_base_url: str
    llm_api_key: str
    llm_model: str
    
    # ADDED: Hugging Face Token and updated model path
    hf_token: str
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    
    session_ttl_minutes: int = 45
    top_k: int = 5
    similarity_threshold: float = 0.25
    frontend_url: str

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        extra="ignore",
    )
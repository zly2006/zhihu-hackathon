from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DK_", extra="ignore")

    database_url: str = (
        "postgresql+psycopg://decision:decision@localhost:5432/decision_knowledge"
    )
    graph_enabled: bool = False
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "decision-local-only"

"""Stable input contract shared by every source adapter."""

from enum import StrEnum
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl, field_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Availability(StrEnum):
    AVAILABLE = "AVAILABLE"
    UPDATED = "UPDATED"
    DELETED = "DELETED"
    INACCESSIBLE = "INACCESSIBLE"


class BodyFormat(StrEnum):
    HTML = "HTML"
    TEXT = "TEXT"
    MARKDOWN = "MARKDOWN"


class SourceDescriptorV1(ContractModel):
    code: str = Field(min_length=1, max_length=64)
    adapter_code: str = Field(min_length=1, max_length=128)
    adapter_version: str = Field(min_length=1, max_length=64)
    authorization_ref: str | None = Field(default=None, max_length=128)


class ExternalParentRefV1(ContractModel):
    type: str = Field(min_length=1, max_length=64)
    id: str = Field(min_length=1, max_length=256)


class ExternalRefV1(ContractModel):
    type: str = Field(min_length=1, max_length=64)
    id: str = Field(min_length=1, max_length=256)
    parent: ExternalParentRefV1 | None = None


class SourceContentV1(ContractModel):
    title: str = Field(min_length=1, max_length=2_000)
    body_format: BodyFormat
    body: str = Field(min_length=1)
    language: str = Field(min_length=2, max_length=32)


class TopicV1(ContractModel):
    external_id: str = Field(min_length=1, max_length=256)
    name: str = Field(min_length=1, max_length=256)


class EngagementV1(ContractModel):
    observed_at: AwareDatetime
    voteup_count: int | None = Field(default=None, ge=0)
    comment_count: int | None = Field(default=None, ge=0)
    thanks_count: int | None = Field(default=None, ge=0)


class RestrictedAuthorV1(ContractModel):
    external_id: str = Field(min_length=1, max_length=512)


class RawEnvelopeV1(ContractModel):
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    payload: dict[str, Any]

    @field_validator("sha256", mode="before")
    @classmethod
    def normalize_sha256(cls, value: object) -> object:
        return value.lower() if isinstance(value, str) else value


class SourceRecordV1(ContractModel):
    schema_version: Literal["source_record.v1"]
    source: SourceDescriptorV1
    external_ref: ExternalRefV1
    canonical_url: HttpUrl
    fetched_at: AwareDatetime
    source_created_at: AwareDatetime | None = None
    source_updated_at: AwareDatetime | None = None
    availability: Availability
    content: SourceContentV1
    topics: tuple[TopicV1, ...] = ()
    engagement: EngagementV1 | None = None
    restricted_author: RestrictedAuthorV1 | None = None
    raw: RawEnvelopeV1

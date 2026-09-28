from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


FaultType = Literal["congestion", "device_failure"]


class TelemetryPoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    recorded_at: datetime = Field(alias="recordedAt")
    latency_ms: float | None = Field(default=None, alias="latencyMs")
    packet_loss_pct: float | None = Field(default=None, alias="packetLossPct")
    jitter_ms: float | None = Field(default=None, alias="jitterMs")
    utilization_pct: float | None = Field(default=None, alias="utilizationPct")
    cpu_pct: float | None = Field(default=None, alias="cpuPct")
    memory_pct: float | None = Field(default=None, alias="memoryPct")
    availability: float | None = None


class PredictRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    device_id: int = Field(gt=0, alias="deviceId")
    window: list[TelemetryPoint] = Field(min_length=15)


class PredictResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fault_type: FaultType = Field(alias="faultType")
    risk_score: float = Field(ge=0.0, le=1.0, alias="riskScore")
    predicted_window_minutes: int = Field(
        gt=0,
        alias="predictedWindowMinutes",
    )
    contributing_features: dict[str, float] = Field(
        alias="contributingFeatures",
    )
    explanation_text: str = Field(
        min_length=1,
        alias="explanationText",
    )
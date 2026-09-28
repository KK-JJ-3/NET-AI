from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum


class ScenarioLabel(str, Enum):
    NORMAL = "normal"
    CONGESTION = "congestion"
    DEVICE_FAILURE = "device_failure"


@dataclass(frozen=True)
class TelemetrySample:
    recorded_at: datetime
    latency_ms: float
    packet_loss_pct: float
    jitter_ms: float
    utilization_pct: float
    cpu_pct: float
    memory_pct: float
    availability: int
    scenario_label: ScenarioLabel


@dataclass(frozen=True)
class ScenarioConfig:
    label: ScenarioLabel
    duration_minutes: int = 30
    interval_seconds: int = 60

    # Controls how quickly the scenario degrades.
    degradation_speed: float = 1.0

    # Controls how severe the final degradation becomes.
    degradation_magnitude: float = 1.0

    # For device failure, determines when the actual failure occurs.
    fault_start_ratio: float = 0.8


def _clamp(
    value: float,
    minimum: float,
    maximum: float,
) -> float:
    return max(minimum, min(value, maximum))


def _validate_config(config: ScenarioConfig) -> None:
    if config.duration_minutes <= 0:
        raise ValueError(
            "duration_minutes must be greater than 0"
        )

    if config.interval_seconds <= 0:
        raise ValueError(
            "interval_seconds must be greater than 0"
        )

    if config.degradation_speed <= 0:
        raise ValueError(
            "degradation_speed must be greater than 0"
        )

    if config.degradation_magnitude <= 0:
        raise ValueError(
            "degradation_magnitude must be greater than 0"
        )

    if not 0.0 < config.fault_start_ratio <= 1.0:
        raise ValueError(
            "fault_start_ratio must be between 0 and 1"
        )


def generate_normal_sample(
    recorded_at: datetime,
    step: int,
) -> TelemetrySample:
    """Generate stable network telemetry."""

    return TelemetrySample(
        recorded_at=recorded_at,
        latency_ms=40.0,
        packet_loss_pct=1.0,
        jitter_ms=5.0,
        utilization_pct=50.0,
        cpu_pct=40.0,
        memory_pct=55.0,
        availability=1,
        scenario_label=ScenarioLabel.NORMAL,
    )


def generate_congestion_sample(
    recorded_at: datetime,
    step: int,
    total_steps: int,
    degradation_speed: float = 1.0,
    degradation_magnitude: float = 1.0,
) -> TelemetrySample:
    """Generate gradually worsening congestion telemetry."""

    base_progress = step / max(total_steps - 1, 1)

    progress = _clamp(
        base_progress * degradation_speed,
        0.0,
        1.0,
    )

    latency = 40.0 + (
        80.0
        * degradation_magnitude
        * progress
    )

    packet_loss = 1.0 + (
        9.0
        * degradation_magnitude
        * progress
    )

    jitter = 5.0 + (
        25.0
        * degradation_magnitude
        * progress
    )

    utilization = 50.0 + (
        48.0
        * degradation_magnitude
        * progress
    )

    cpu = 40.0 + (
        45.0
        * degradation_magnitude
        * progress
    )

    memory = 55.0 + (
        35.0
        * degradation_magnitude
        * progress
    )

    return TelemetrySample(
        recorded_at=recorded_at,
        latency_ms=round(
            _clamp(latency, 0.0, 500.0),
            3,
        ),
        packet_loss_pct=round(
            _clamp(packet_loss, 0.0, 100.0),
            3,
        ),
        jitter_ms=round(
            _clamp(jitter, 0.0, 200.0),
            3,
        ),
        utilization_pct=round(
            _clamp(utilization, 0.0, 100.0),
            3,
        ),
        cpu_pct=round(
            _clamp(cpu, 0.0, 100.0),
            3,
        ),
        memory_pct=round(
            _clamp(memory, 0.0, 100.0),
            3,
        ),
        availability=1,
        scenario_label=ScenarioLabel.CONGESTION,
    )


def generate_device_failure_sample(
    recorded_at: datetime,
    step: int,
    total_steps: int,
    degradation_speed: float = 1.0,
    degradation_magnitude: float = 1.0,
    fault_start_ratio: float = 0.8,
) -> TelemetrySample:
    """Generate telemetry that progressively leads to device failure."""

    base_progress = step / max(total_steps - 1, 1)

    progress = _clamp(
        base_progress * degradation_speed,
        0.0,
        1.0,
    )

    latency = 40.0 + (
        60.0
        * degradation_magnitude
        * progress
    )

    packet_loss = 1.0 + (
        5.0
        * degradation_magnitude
        * progress
    )

    jitter = 5.0 + (
        15.0
        * degradation_magnitude
        * progress
    )

    utilization = 50.0 + (
        20.0
        * degradation_magnitude
        * progress
    )

    cpu = 40.0 + (
        25.0
        * degradation_magnitude
        * progress
    )

    memory = 55.0 + (
        25.0
        * degradation_magnitude
        * progress
    )

    availability = 1

    if base_progress >= fault_start_ratio:
        availability = 0
        latency = 0.0
        packet_loss = 100.0

    return TelemetrySample(
        recorded_at=recorded_at,
        latency_ms=round(
            _clamp(latency, 0.0, 500.0),
            3,
        ),
        packet_loss_pct=round(
            _clamp(packet_loss, 0.0, 100.0),
            3,
        ),
        jitter_ms=round(
            _clamp(jitter, 0.0, 200.0),
            3,
        ),
        utilization_pct=round(
            _clamp(utilization, 0.0, 100.0),
            3,
        ),
        cpu_pct=round(
            _clamp(cpu, 0.0, 100.0),
            3,
        ),
        memory_pct=round(
            _clamp(memory, 0.0, 100.0),
            3,
        ),
        availability=availability,
        scenario_label=ScenarioLabel.DEVICE_FAILURE,
    )


def generate_scenario(
    config: ScenarioConfig,
    start_time: datetime,
) -> list[TelemetrySample]:
    """Generate a complete deterministic telemetry episode."""

    _validate_config(config)

    total_seconds = (
        config.duration_minutes * 60
    )

    total_steps = (
        total_seconds // config.interval_seconds
    ) + 1

    samples: list[TelemetrySample] = []

    for step in range(total_steps):
        recorded_at = start_time + timedelta(
            seconds=step * config.interval_seconds
        )

        if config.label == ScenarioLabel.NORMAL:
            sample = generate_normal_sample(
                recorded_at,
                step,
            )

        elif config.label == ScenarioLabel.CONGESTION:
            sample = generate_congestion_sample(
                recorded_at=recorded_at,
                step=step,
                total_steps=total_steps,
                degradation_speed=config.degradation_speed,
                degradation_magnitude=config.degradation_magnitude,
            )

        elif config.label == ScenarioLabel.DEVICE_FAILURE:
            sample = generate_device_failure_sample(
                recorded_at=recorded_at,
                step=step,
                total_steps=total_steps,
                degradation_speed=config.degradation_speed,
                degradation_magnitude=config.degradation_magnitude,
                fault_start_ratio=config.fault_start_ratio,
            )

        else:
            raise ValueError(
                f"Unsupported scenario: {config.label}"
            )

        samples.append(sample)

    return samples
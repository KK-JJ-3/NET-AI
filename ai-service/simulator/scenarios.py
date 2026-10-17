from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime
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
    degradation_speed: float = 1.0
    degradation_magnitude: float = 1.0
    fault_start_ratio: float = 0.8


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def generate_normal_sample(
    recorded_at: datetime,
    rng: random.Random,
) -> TelemetrySample:
    return TelemetrySample(
        recorded_at=recorded_at,
        latency_ms=_clamp(rng.gauss(30, 4), 5, 100),
        packet_loss_pct=_clamp(rng.gauss(0.4, 0.15), 0, 5),
        jitter_ms=_clamp(rng.gauss(3.5, 0.8), 0, 20),
        utilization_pct=_clamp(rng.gauss(40, 8), 5, 85),
        cpu_pct=_clamp(rng.gauss(35, 8), 5, 85),
        memory_pct=_clamp(rng.gauss(50, 7), 10, 90),
        availability=1,
        scenario_label=ScenarioLabel.NORMAL,
    )


def generate_congestion_sample(
    recorded_at: datetime,
    progress: float,
    degradation_magnitude: float,
) -> TelemetrySample:
    progress = _clamp(progress, 0.0, 1.0)
    magnitude = max(0.0, degradation_magnitude)

    # Gradually introduce stronger congestion as the episode progresses.
    fault_progress = _clamp((progress - 0.55) / 0.25, 0.0, 1.0)

    latency = 40 + 45 * magnitude * progress + 70 * fault_progress
    utilization = 50 + 25 * magnitude * progress + 45 * fault_progress
    packet_loss = 1 + 9 * magnitude * progress
    jitter = 5 + 25 * magnitude * progress
    cpu = 40 + 45 * magnitude * progress
    memory = 55 + 35 * magnitude * progress

    return TelemetrySample(
        recorded_at=recorded_at,
        latency_ms=_clamp(latency, 1, 250),
        packet_loss_pct=_clamp(packet_loss, 0, 100),
        jitter_ms=_clamp(jitter, 0, 100),
        utilization_pct=_clamp(utilization, 0, 100),
        cpu_pct=_clamp(cpu, 0, 100),
        memory_pct=_clamp(memory, 0, 100),
        availability=1,
        scenario_label=ScenarioLabel.CONGESTION,
    )


def generate_device_failure_sample(
    recorded_at: datetime,
    progress: float,
    fault_start_ratio: float,
    degradation_magnitude: float,
) -> TelemetrySample:
    progress = _clamp(progress, 0.0, 1.0)
    magnitude = max(0.0, degradation_magnitude)

    latency = 40 + 35 * magnitude * progress
    packet_loss = 1 + 4 * magnitude * progress
    jitter = 5 + 12 * magnitude * progress
    utilization = 50 + 20 * magnitude * progress
    cpu = 40 + 30 * magnitude * progress
    memory = 55 + 25 * magnitude * progress

    availability = 1

    if progress >= fault_start_ratio:
        availability = 0
        latency = 0
        packet_loss = 100

    return TelemetrySample(
        recorded_at=recorded_at,
        latency_ms=_clamp(latency, 0, 250),
        packet_loss_pct=_clamp(packet_loss, 0, 100),
        jitter_ms=_clamp(jitter, 0, 100),
        utilization_pct=_clamp(utilization, 0, 100),
        cpu_pct=_clamp(cpu, 0, 100),
        memory_pct=_clamp(memory, 0, 100),
        availability=availability,
        scenario_label=ScenarioLabel.DEVICE_FAILURE,
    )


def generate_scenario(
    config: ScenarioConfig,
    start_time: datetime,
) -> list[TelemetrySample]:
    if config.duration_minutes <= 0:
        raise ValueError("duration_minutes must be positive")

    if config.interval_seconds <= 0:
        raise ValueError("interval_seconds must be positive")

    if config.degradation_speed <= 0:
        raise ValueError("degradation_speed must be positive")

    if config.degradation_magnitude < 0:
        raise ValueError("degradation_magnitude cannot be negative")

    if not 0 <= config.fault_start_ratio <= 1:
        raise ValueError("fault_start_ratio must be between 0 and 1")

    total_steps = (
        config.duration_minutes * 60 // config.interval_seconds
    ) + 1

    seed = (
        int(start_time.timestamp())
        + sum(ord(char) for char in config.label.value)
        + config.duration_minutes
        + config.interval_seconds
    )
    rng = random.Random(seed)

    recovery_start_ratio = {
        ScenarioLabel.NORMAL: 1.1,
        ScenarioLabel.CONGESTION: 0.8,
        ScenarioLabel.DEVICE_FAILURE: 0.98,
    }[config.label]

    samples: list[TelemetrySample] = []

    for step in range(total_steps):
        base_progress = step / (total_steps - 1) if total_steps > 1 else 1.0

        # Congestion must reach its detectable peak before recovery.
        effective_speed = config.degradation_speed
        if config.label == ScenarioLabel.CONGESTION:
            effective_speed = max(effective_speed, 1.25)

        progress = min(1.0, base_progress * effective_speed)

        recovering = (
            config.label != ScenarioLabel.NORMAL
            and base_progress > recovery_start_ratio
        )

        recorded_at = start_time.replace() + __import__(
            "datetime"
        ).timedelta(seconds=step * config.interval_seconds)

        if config.label == ScenarioLabel.NORMAL or recovering:
            sample = generate_normal_sample(recorded_at, rng)

        elif config.label == ScenarioLabel.CONGESTION:
            sample = generate_congestion_sample(
                recorded_at=recorded_at,
                progress=progress,
                degradation_magnitude=config.degradation_magnitude,
            )

        elif config.label == ScenarioLabel.DEVICE_FAILURE:
            sample = generate_device_failure_sample(
                recorded_at=recorded_at,
                progress=base_progress,
                fault_start_ratio=config.fault_start_ratio,
                degradation_magnitude=config.degradation_magnitude,
            )

        else:
            raise ValueError(f"Unsupported scenario label: {config.label}")

        samples.append(sample)

    return samples
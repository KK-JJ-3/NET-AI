from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from simulator.scenarios import (
    ScenarioConfig,
    ScenarioLabel,
    generate_scenario,
)


DEFAULT_EPISODES_PER_CLASS = 50
DEFAULT_DURATION_MINUTES = 30
DEFAULT_INTERVAL_SECONDS = 60
DEFAULT_RANDOM_SEED = 42


def generate_dataset(
    episodes_per_class: int = DEFAULT_EPISODES_PER_CLASS,
    duration_minutes: int = DEFAULT_DURATION_MINUTES,
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
    random_seed: int = DEFAULT_RANDOM_SEED,
) -> pd.DataFrame:
    """Generate a reproducible dataset with varied fault episodes."""

    if episodes_per_class <= 0:
        raise ValueError(
            "episodes_per_class must be greater than 0"
        )

    if duration_minutes <= 0:
        raise ValueError(
            "duration_minutes must be greater than 0"
        )

    if interval_seconds <= 0:
        raise ValueError(
            "interval_seconds must be greater than 0"
        )

    rng = np.random.default_rng(random_seed)

    rows: list[dict[str, object]] = []

    scenarios = (
        ScenarioLabel.NORMAL,
        ScenarioLabel.CONGESTION,
        ScenarioLabel.DEVICE_FAILURE,
    )

    episode_number = 0

    for scenario in scenarios:
        for episode_index in range(episodes_per_class):
            episode_number += 1

            if scenario == ScenarioLabel.NORMAL:
                degradation_speed = 1.0
                degradation_magnitude = 1.0
                fault_start_ratio = 0.8

            elif scenario == ScenarioLabel.CONGESTION:
                degradation_speed = float(
                    rng.uniform(0.7, 1.5)
                )

                degradation_magnitude = float(
                    rng.uniform(0.7, 1.3)
                )

                fault_start_ratio = 0.8

            else:
                degradation_speed = float(
                    rng.uniform(0.7, 1.5)
                )

                degradation_magnitude = float(
                    rng.uniform(0.7, 1.3)
                )

                fault_start_ratio = float(
                    rng.uniform(0.6, 0.9)
                )

            start_time = (
                datetime(
                    2026,
                    1,
                    1,
                    tzinfo=timezone.utc,
                )
                + timedelta(
                    days=episode_number - 1,
                )
            )

            config = ScenarioConfig(
                label=scenario,
                duration_minutes=duration_minutes,
                interval_seconds=interval_seconds,
                degradation_speed=degradation_speed,
                degradation_magnitude=degradation_magnitude,
                fault_start_ratio=fault_start_ratio,
            )

            samples = generate_scenario(
                config=config,
                start_time=start_time,
            )

            for sample in samples:
                rows.append(
                    {
                        "episode_id": episode_number,
                        "episode_index": episode_index,
                        "recorded_at": sample.recorded_at,
                        "latency_ms": sample.latency_ms,
                        "packet_loss_pct": sample.packet_loss_pct,
                        "jitter_ms": sample.jitter_ms,
                        "utilization_pct": sample.utilization_pct,
                        "cpu_pct": sample.cpu_pct,
                        "memory_pct": sample.memory_pct,
                        "availability": sample.availability,
                        "scenario_label": sample.scenario_label.value,
                    }
                )

    return pd.DataFrame(rows)
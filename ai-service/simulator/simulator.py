from __future__ import annotations

from datetime import datetime, timezone

from simulator.scenarios import (
    ScenarioConfig,
    ScenarioLabel,
    generate_scenario,
)


def run_scenario(
    scenario: ScenarioLabel,
    duration_minutes: int = 30,
    interval_seconds: int = 60,
) -> None:
    config = ScenarioConfig(
        label=scenario,
        duration_minutes=duration_minutes,
        interval_seconds=interval_seconds,
    )

    start_time = datetime.now(timezone.utc)

    samples = generate_scenario(
        config=config,
        start_time=start_time,
    )

    print(f"Scenario: {scenario.value}")
    print(f"Samples generated: {len(samples)}")
    print()

    for sample in samples:
        print(
            f"{sample.recorded_at.isoformat()} | "
            f"latency={sample.latency_ms:.2f}ms | "
            f"loss={sample.packet_loss_pct:.2f}% | "
            f"jitter={sample.jitter_ms:.2f}ms | "
            f"utilization={sample.utilization_pct:.2f}% | "
            f"cpu={sample.cpu_pct:.2f}% | "
            f"memory={sample.memory_pct:.2f}% | "
            f"availability={sample.availability} | "
            f"scenario={sample.scenario_label.value}"
        )


if __name__ == "__main__":
    run_scenario(
        scenario=ScenarioLabel.CONGESTION,
        duration_minutes=10,
        interval_seconds=60,
    )
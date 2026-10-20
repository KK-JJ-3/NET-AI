from datetime import datetime, timezone

from simulator.run_simulator import append_healthy_tail
from simulator.scenarios import ScenarioConfig, ScenarioLabel, generate_scenario


def test_healthy_tail_extends_timeline_and_uses_normal_samples():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    samples = generate_scenario(
        ScenarioConfig(label=ScenarioLabel.DEVICE_FAILURE, duration_minutes=2, interval_seconds=60),
        start,
    )

    result = append_healthy_tail(samples, tail_minutes=3, interval_seconds=60)

    assert len(result) == len(samples) + 3
    assert result[len(samples)].recorded_at > samples[-1].recorded_at
    assert (result[-1].recorded_at - samples[-1].recorded_at).total_seconds() == 3 * 60
    assert all(sample.scenario_label == ScenarioLabel.NORMAL for sample in result[len(samples):])
    assert all(sample.availability == 1 for sample in result[len(samples):])


def test_zero_tail_does_not_change_samples():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    samples = generate_scenario(
        ScenarioConfig(label=ScenarioLabel.NORMAL, duration_minutes=1, interval_seconds=60),
        start,
    )

    assert append_healthy_tail(samples, tail_minutes=0, interval_seconds=60) == samples

from datetime import datetime, timedelta, timezone

from simulator.run_simulator import (
    append_healthy_tail,
    choose_live_recorded_at,
    choose_simulation_start,
    get_latest_recorded_at,
)
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


def test_simulation_start_uses_now_when_no_telemetry_exists():
    now = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)

    assert choose_simulation_start(now, None, 60) == now


def test_simulation_start_uses_now_when_latest_reading_is_in_the_past():
    now = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)
    latest = now - timedelta(minutes=10)

    assert choose_simulation_start(now, latest, 60) == now


def test_simulation_start_continues_after_future_dated_reading():
    now = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)
    latest = now + timedelta(minutes=70)

    assert choose_simulation_start(now, latest, 60) == latest + timedelta(seconds=60)


def test_latest_recorded_at_reads_the_latest_timestamp_from_backend():
    class FakeResponse:
        ok = True
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {
                "data": {
                    "deviceId": 7,
                    "latestRecordedAt": "2026-10-24T13:10:00Z",
                },
                "error": None,
            }

    class FakeSession:
        def __init__(self):
            self.url = None
            self.kwargs = None

        def get(self, url, **kwargs):
            self.url = url
            self.kwargs = kwargs
            return FakeResponse()

    session = FakeSession()
    result = get_latest_recorded_at(session, "http://localhost:5000/api", 7)

    assert result == datetime(2026, 10, 24, 13, 10, tzinfo=timezone.utc)
    assert session.url == "http://localhost:5000/api/devices/7/telemetry/latest"
    assert session.kwargs["timeout"] > 0


def test_latest_recorded_at_returns_none_when_device_has_no_readings():
    class FakeResponse:
        ok = True
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"data": {"deviceId": 7, "latestRecordedAt": None}, "error": None}

    class FakeSession:
        def get(self, url, **kwargs):
            return FakeResponse()

    assert get_latest_recorded_at(FakeSession(), "http://localhost:5000/api", 7) is None


def test_live_timestamp_uses_wall_clock_when_it_is_after_timeline_floor():
    start = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)
    now = start + timedelta(minutes=3)

    result = choose_live_recorded_at(now, start, sample_index=1, interval_seconds=60)

    assert result == now


def test_live_timestamp_preserves_future_timeline_after_accelerated_run():
    start = datetime(2026, 10, 24, 13, 10, tzinfo=timezone.utc)
    now = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)

    first = choose_live_recorded_at(now, start, sample_index=0, interval_seconds=60)
    second = choose_live_recorded_at(now, start, sample_index=1, interval_seconds=60)

    assert first == start
    assert second == start + timedelta(minutes=1)
    assert second > first


def test_live_timestamp_rejects_invalid_interval_or_index():
    now = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)

    import pytest

    with pytest.raises(ValueError, match="interval_seconds"):
        choose_live_recorded_at(now, now, sample_index=0, interval_seconds=0)
    with pytest.raises(ValueError, match="sample_index"):
        choose_live_recorded_at(now, now, sample_index=-1, interval_seconds=60)

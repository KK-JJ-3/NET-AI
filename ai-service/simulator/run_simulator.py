
from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from simulator.scenarios import (
    ScenarioConfig,
    ScenarioLabel,
    TelemetrySample,
    generate_scenario,
)

DEFAULT_API_URL = "http://localhost:5000/api"
REQUEST_TIMEOUT_SECONDS = 15


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Send simulated network telemetry to NET-AI."
    )
    parser.add_argument(
        "--scenario",
        choices=[scenario.value for scenario in ScenarioLabel],
        default="normal",
    )
    parser.add_argument("--device-id", type=int, required=True)
    parser.add_argument("--interface-id", type=int, default=None)
    parser.add_argument("--duration", type=int, default=30)
    parser.add_argument(
        "--tail-minutes",
        type=int,
        default=10,
        help="Append healthy telemetry after the scenario so forecast windows can expire (0 disables the tail).",
    )
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--pace-seconds", type=float, default=None)
    parser.add_argument(
        "--time-mode",
        choices=["live", "accelerated"],
        default="live",
        help="Live uses wall-clock timestamps; accelerated uses simulated timestamps.",
    )
    parser.add_argument("--base-url", default=DEFAULT_API_URL)

    args = parser.parse_args()

    if args.device_id <= 0:
        parser.error("--device-id must be positive")
    if args.interface_id is not None and args.interface_id <= 0:
        parser.error("--interface-id must be positive")
    if args.duration <= 0 or args.interval <= 0:
        parser.error("--duration and --interval must be positive")
    if args.tail_minutes < 0:
        parser.error("--tail-minutes cannot be negative")
    if args.pace_seconds is not None and args.pace_seconds < 0:
        parser.error("--pace-seconds cannot be negative")

    return args


def response_payload(response: requests.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        payload = {"responseText": response.text}

    if not response.ok:
        raise RuntimeError(
            f"API request failed ({response.status_code}): {payload}"
        )

    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected API response: {payload}")

    return payload


def login(session: requests.Session, base_url: str) -> str:
    username = os.getenv("NETFAULT_USERNAME")
    password = os.getenv("NETFAULT_PASSWORD")

    if not username or not password:
        raise RuntimeError(
            "Set NETFAULT_USERNAME and NETFAULT_PASSWORD environment variables."
        )

    response = session.post(
        f"{base_url.rstrip('/')}/auth/login",
        json={"username": username, "password": password},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    payload = response_payload(response)
    data = payload.get("data", payload)
    token = data.get("token") if isinstance(data, dict) else None

    if not isinstance(token, str) or not token:
        raise RuntimeError(f"Login returned no token: {payload}")

    session.headers.update({"Authorization": f"Bearer {token}"})
    return username


def parse_recorded_at(value: Any) -> datetime:
    if not isinstance(value, str):
        raise RuntimeError(f"Telemetry timestamp is not a string: {value!r}")

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError(f"Invalid telemetry timestamp: {value!r}") from error

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def get_latest_recorded_at(
    session: requests.Session, base_url: str, device_id: int
) -> datetime | None:
    """Read the latest persisted timestamp, including future-dated accelerated data."""
    response = session.get(
        f"{base_url.rstrip('/')}/devices/{device_id}/telemetry/latest",
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    payload = response_payload(response)
    data = payload.get("data", payload)

    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected latest-telemetry response: {payload}")

    value = data.get("latestRecordedAt")
    return None if value is None else parse_recorded_at(value)


def choose_simulation_start(
    now: datetime, latest_recorded_at: datetime | None, interval_seconds: int
) -> datetime:
    """Keep a new run after stored telemetry while never starting before now."""
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be positive")

    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)

    if latest_recorded_at is None:
        return now

    latest = latest_recorded_at
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    latest = latest.astimezone(timezone.utc)

    return max(now, latest + timedelta(seconds=interval_seconds))


def choose_live_recorded_at(
    now: datetime,
    simulation_start: datetime,
    sample_index: int,
    interval_seconds: int,
) -> datetime:
    """Keep live timestamps on the device timeline without dating samples in the past.

    Normally ``now`` wins and timestamps follow wall-clock send time. If prior
    accelerated runs left future-dated telemetry, the timeline floor wins until
    wall-clock time catches up.
    """
    if sample_index < 0:
        raise ValueError("sample_index cannot be negative")
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be positive")

    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)

    if simulation_start.tzinfo is None:
        simulation_start = simulation_start.replace(tzinfo=timezone.utc)
    simulation_start = simulation_start.astimezone(timezone.utc)

    timestamp_floor = simulation_start + timedelta(
        seconds=sample_index * interval_seconds
    )
    return max(now, timestamp_floor)


def is_fault_onset(sample: TelemetrySample) -> bool:
    if sample.scenario_label == ScenarioLabel.DEVICE_FAILURE:
        return sample.availability == 0

    if sample.scenario_label == ScenarioLabel.CONGESTION:
        return (
            sample.availability == 1
            and sample.utilization_pct >= 90
            and sample.latency_ms >= 100
        )

    return False


def post_telemetry(
    session: requests.Session,
    base_url: str,
    device_id: int,
    interface_id: int | None,
    sample: TelemetrySample,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "deviceId": device_id,
        "recordedAt": sample.recorded_at.isoformat(),
        "latencyMs": sample.latency_ms,
        "packetLossPct": sample.packet_loss_pct,
        "jitterMs": sample.jitter_ms,
        "utilizationPct": sample.utilization_pct,
        "cpuPct": sample.cpu_pct,
        "memoryPct": sample.memory_pct,
        "availability": bool(sample.availability),
        "scenarioLabel": sample.scenario_label.value,
    }

    if interface_id is not None:
        body["interfaceId"] = interface_id

    response = session.post(
        f"{base_url.rstrip('/')}/telemetry",
        json=body,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return response_payload(response)


def post_actual_fault(
    session: requests.Session,
    base_url: str,
    device_id: int,
    sample: TelemetrySample,
) -> dict[str, Any]:
    fault_type = sample.scenario_label.value

    if fault_type not in {"congestion", "device_failure"}:
        raise ValueError(f"Unsupported actual fault type: {fault_type}")

    response = session.post(
        f"{base_url.rstrip('/')}/faults",
        json={
            "deviceId": device_id,
            "faultType": fault_type,
            "severity": (
                "critical" if fault_type == "device_failure" else "high"
            ),
            "startedAt": sample.recorded_at.isoformat(),
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return response_payload(response)


def resolve_actual_fault(
    session: requests.Session,
    base_url: str,
    fault_id: int,
    sample: TelemetrySample,
) -> dict[str, Any]:
    response = session.patch(
        f"{base_url.rstrip('/')}/faults/{fault_id}/resolve",
        json={"resolvedAt": sample.recorded_at.isoformat()},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return response_payload(response)


def resolve_open_fault_on_exit(
    session: requests.Session,
    base_url: str,
    fault_id: int | None,
    fault_resolved: bool,
    last_sent_sample: TelemetrySample | None,
    fault_onset_sample: TelemetrySample | None,
) -> bool:
    """Resolve a recorded fault when a simulator run exits early.

    Prefer the timestamp of the last telemetry sample successfully submitted.
    If telemetry submission failed immediately after recording the fault, fall
    back to the onset sample timestamp so the recorded fault does not remain
    open indefinitely.
    """
    if fault_id is None or fault_resolved:
        return fault_resolved

    resolution_sample = last_sent_sample or fault_onset_sample
    if resolution_sample is None:
        return False

    resolve_actual_fault(session, base_url, fault_id, resolution_sample)
    return True


def extract_fault_id(payload: dict[str, Any]) -> int:
    data = payload.get("data", payload)
    fault_id = data.get("id") if isinstance(data, dict) else None

    if (
        isinstance(fault_id, bool)
        or not isinstance(fault_id, int)
        or fault_id <= 0
    ):
        raise RuntimeError(f"Fault creation returned no valid ID: {payload}")

    return fault_id


def append_healthy_tail(
    samples: list[TelemetrySample], tail_minutes: int, interval_seconds: int
) -> list[TelemetrySample]:
    """Append normal samples so pending forecast windows can expire in the backend.

    The backend outcome job evaluates against the latest persisted telemetry
    timestamp. Accelerated simulations otherwise finish before forecast windows
    expire in simulation time, leaving those predictions pending.
    """
    if tail_minutes == 0 or not samples:
        return list(samples)

    tail_start = samples[-1].recorded_at
    tail = generate_scenario(
        ScenarioConfig(
            label=ScenarioLabel.NORMAL,
            duration_minutes=tail_minutes,
            interval_seconds=interval_seconds,
        ),
        tail_start,
    )
    # The generated first sample is at the existing final timestamp; omit it
    # so the tail adds exactly tail_minutes of new simulated time.
    return [*samples, *tail[1:]]


def run(args: argparse.Namespace) -> None:
    scenario = ScenarioLabel(args.scenario)

    if args.pace_seconds is not None:
        pace = args.pace_seconds
    elif args.time_mode == "live":
        pace = float(args.interval)
    else:
        pace = 0.0

    config = ScenarioConfig(
        label=scenario,
        duration_minutes=args.duration,
        interval_seconds=args.interval,
    )

    scenario_samples: list[TelemetrySample] = []
    samples: list[TelemetrySample] = []
    simulation_start = datetime.now(timezone.utc)

    fault_id: int | None = None
    fault_resolved = False
    fault_onset_sample: TelemetrySample | None = None
    last_sent_sample: TelemetrySample | None = None
    sent_count = 0
    interrupted = False

    with requests.Session() as session:
        username = login(session, args.base_url)
        print(f"Authenticated as {username}.")

        latest_recorded_at = get_latest_recorded_at(
            session, args.base_url, args.device_id
        )
        simulation_start = choose_simulation_start(
            datetime.now(timezone.utc), latest_recorded_at, args.interval
        )
        if latest_recorded_at is not None:
            print(f"Latest stored telemetry: {latest_recorded_at.isoformat()}")
        print(f"Simulation starts at: {simulation_start.isoformat()}\n")

        scenario_samples = generate_scenario(config, simulation_start)
        samples = append_healthy_tail(
            scenario_samples, args.tail_minutes, args.interval
        )

        print(f"Scenario: {scenario.value}")
        print(f"Device ID: {args.device_id}")
        print(f"Scenario samples: {len(scenario_samples)}")
        print(f"Healthy tail samples: {len(samples) - len(scenario_samples)}")
        print(f"Total samples: {len(samples)}")
        print(f"Time mode: {args.time_mode}")
        print(f"Sample interval: {args.interval} simulated seconds")
        print(f"Send pace: {pace:g} real seconds")
        print(f"API: {args.base_url}\n")

        # Pacing is measured from the start of the first sample, avoiding
        # accumulated sleep drift during long simulations.
        wall_start = time.monotonic()

        try:
            for index, original_sample in enumerate(samples):
                if index > 0 and pace > 0:
                    deadline = wall_start + index * pace
                    remaining = deadline - time.monotonic()
                    if remaining > 0:
                        time.sleep(remaining)

                if args.time_mode == "live":
                    # Normally this follows wall-clock send time. If an earlier
                    # accelerated run left future-dated readings, preserve the
                    # device timeline instead of inserting older timestamps.
                    sample = replace(
                        original_sample,
                        recorded_at=choose_live_recorded_at(
                            datetime.now(timezone.utc),
                            simulation_start,
                            index,
                            args.interval,
                        ),
                    )
                else:
                    # Keep the generated simulation timeline, even when
                    # samples are submitted much faster than real time.
                    sample = original_sample

                # Persist the event before telemetry can trigger prediction
                # processing or a scheduled outcome evaluation.
                if fault_id is None and is_fault_onset(sample):
                    created = post_actual_fault(
                        session,
                        args.base_url,
                        args.device_id,
                        sample,
                    )
                    fault_id = extract_fault_id(created)
                    fault_onset_sample = sample
                    print(
                        f"    Fault #{fault_id} recorded at "
                        f"{sample.recorded_at.isoformat()}."
                    )

                elif (
                    fault_id is not None
                    and not fault_resolved
                    and sample.scenario_label == ScenarioLabel.NORMAL
                ):
                    resolve_actual_fault(
                        session,
                        args.base_url,
                        fault_id,
                        sample,
                    )
                    fault_resolved = True
                    print(
                        f"    Fault #{fault_id} resolved at "
                        f"{sample.recorded_at.isoformat()}."
                    )

                result = post_telemetry(
                    session,
                    args.base_url,
                    args.device_id,
                    args.interface_id,
                    sample,
                )
                sent_count += 1
                last_sent_sample = sample

                print(
                    f"[{index + 1}/{len(samples)}] "
                    f"{sample.recorded_at.isoformat()} | "
                    f"latency={sample.latency_ms:.1f}ms | "
                    f"loss={sample.packet_loss_pct:.1f}% | "
                    f"utilization={sample.utilization_pct:.1f}% | "
                    f"availability={sample.availability}"
                )

                data = result.get("data", {})
                if isinstance(data, dict) and data.get("prediction") is not None:
                    print("    Prediction generated.")

        except KeyboardInterrupt:
            interrupted = True
            print("\nSimulation interrupted.")

        finally:
            if fault_id is not None and not fault_resolved:
                try:
                    fault_resolved = resolve_open_fault_on_exit(
                        session,
                        args.base_url,
                        fault_id,
                        fault_resolved,
                        last_sent_sample,
                        fault_onset_sample,
                    )
                    if fault_resolved:
                        resolution_sample = last_sent_sample or fault_onset_sample
                        assert resolution_sample is not None
                        print(
                            f"\n    Fault #{fault_id} automatically resolved "
                            f"during simulator cleanup at "
                            f"{resolution_sample.recorded_at.isoformat()}."
                        )
                    else:
                        print(
                            f"\nWARNING: Fault #{fault_id} could not be "
                            "automatically resolved; manual recovery may be needed.",
                            file=sys.stderr,
                        )
                except (requests.RequestException, RuntimeError, ValueError) as error:
                    print(
                        f"\nWARNING: Failed to resolve fault #{fault_id} "
                        f"during simulator cleanup: {error}. Manual recovery "
                        "may be needed.",
                        file=sys.stderr,
                    )

            print("\n--- Simulator summary ---")
            print(f"Telemetry submitted: {sent_count}/{len(samples)}")
            print(f"Fault recorded: {'yes' if fault_id is not None else 'no'}")
            print(f"Fault resolved: {'yes' if fault_resolved else 'no'}")
            print(f"Interrupted: {'yes' if interrupted else 'no'}")

            if scenario == ScenarioLabel.NORMAL:
                print("Normal scenario: no actual fault expected.")
            elif fault_id is None and sent_count == len(samples):
                print("WARNING: No sample reached fault-onset thresholds.")


def main() -> int:
    try:
        run(parse_args())
        return 0
    except requests.RequestException as error:
        print(f"Simulator API connection error: {error}", file=sys.stderr)
        return 1
    except (RuntimeError, ValueError) as error:
        print(f"Simulator error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

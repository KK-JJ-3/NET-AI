
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureContribution:
    name: str
    importance: float
    current_value: float
    slope: float
    elevated: bool = False
    degraded: bool = False
    increasing: bool = False


FEATURE_LABELS = {
    "utilization_pct": "network utilization",
    "latency_ms": "latency",
    "packet_loss_pct": "packet loss",
    "jitter_ms": "jitter",
    "cpu_pct": "CPU usage",
    "memory_pct": "memory usage",
    "availability": "availability",
}

SLOPE_EPSILON = 1e-6
RELATIVE_ELEVATION_THRESHOLD = 0.05


def _base_feature_name(
    feature_name: str,
) -> str | None:
    for base_name in FEATURE_LABELS:
        if feature_name.startswith(
            f"{base_name}_"
        ):
            return base_name

    return None


def _is_meaningfully_different(
    value: float,
    baseline: float,
) -> bool:
    tolerance = max(
        abs(baseline) * RELATIVE_ELEVATION_THRESHOLD,
        1e-6,
    )

    return abs(value - baseline) > tolerance



def select_contributors(
    feature_importance: dict[str, float],
    current_features: dict[str, float],
    top_n: int = 3,
    normal_baseline: dict[str, float] | None = None,
) -> list[FeatureContribution]:
    """
    Rank unique telemetry metrics using model importance
    and deviation from the normal training baseline.

    Returned importance values are normalized relative
    contribution scores, not fault probabilities.
    """

    if top_n <= 0:
        raise ValueError(
            "top_n must be greater than 0"
        )

    # Keep the strongest engineered feature for each metric.
    best_by_metric: dict[
        str,
        tuple[float, FeatureContribution],
    ] = {}

    for feature_name, raw_importance in (
        feature_importance.items()
    ):
        base_name = _base_feature_name(feature_name)

        if base_name is None:
            continue

        if feature_name not in current_features:
            continue

        importance = max(
            0.0,
            float(raw_importance),
        )

        current_feature_value = float(
            current_features[feature_name]
        )

        if normal_baseline is None:
            # Compatibility fallback if no baseline is supplied.
            deviation_score = 1.0
        else:
            baseline_value = normal_baseline.get(
                feature_name
            )

            if baseline_value is None:
                continue

            baseline_value = float(baseline_value)
            difference = abs(
                current_feature_value - baseline_value
            )

            if feature_name.endswith("_slope"):
                if (
                    abs(current_feature_value) < SLOPE_EPSILON
                    and abs(baseline_value) < SLOPE_EPSILON
                ):
                    difference = 0.0

            # Scale the deviation to reduce differences caused
            # solely by different measurement units.
            deviation_score = difference / max(
                abs(baseline_value),
                1.0,
            )

            deviation_score = min(
                deviation_score,
                2.0,
            )

        raw_score = importance * deviation_score

        baseline_current = (
            float(
                normal_baseline.get(
                    f"{base_name}_current",
                    0.0,
                )
            )
            if normal_baseline is not None
            else 0.0
        )

        current_value = float(
            current_features.get(
                f"{base_name}_current",
                0.0,
            )
        )

        slope = float(
            current_features.get(
                f"{base_name}_slope",
                0.0,
            )
        )

        tolerance = max(
            abs(baseline_current)
            * RELATIVE_ELEVATION_THRESHOLD,
            1e-6,
        )

        elevated = (
            current_value > baseline_current + tolerance
        )

        degraded = (
            base_name == "availability"
            and current_value < baseline_current - tolerance
        )

        increasing = (
            slope >= SLOPE_EPSILON
        )

        contribution = FeatureContribution(
            name=base_name,
            importance=raw_score,
            current_value=current_value,
            slope=slope,
            elevated=elevated,
            degraded=degraded,
            increasing=increasing,
        )

        existing = best_by_metric.get(base_name)

        if (
            existing is None
            or raw_score > existing[0]
        ):
            best_by_metric[base_name] = (
                raw_score,
                contribution,
            )

    # Exclude metrics with no importance or no measured deviation.
    ranked = [
        (score, contribution)
        for score, contribution in best_by_metric.values()
        if score > 0.0
    ]

    ranked.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    selected = ranked[:top_n]

    if not selected:
        return []

    total_score = sum(
        score for score, _ in selected
    )

    if total_score <= 0.0:
        return []

    # Normalize the selected scores so they sum to 1.
    return [
        FeatureContribution(
            name=contribution.name,
            importance=score / total_score,
            current_value=contribution.current_value,
            slope=contribution.slope,
            elevated=contribution.elevated,
            degraded=contribution.degraded,
            increasing=contribution.increasing,
        )
        for score, contribution in selected
    ]



def _format_feature(
    contribution: FeatureContribution,
) -> str:
    label = FEATURE_LABELS.get(
        contribution.name,
        contribution.name,
    )

    if contribution.name == "availability":
        if contribution.degraded:
            return f"{label} is degraded"

        return f"{label} is near its normal level"

    if contribution.elevated and contribution.increasing:
        return f"{label} is elevated and increasing"

    if contribution.elevated:
        return f"{label} is elevated above its normal level"

    if contribution.increasing:
        return f"{label} is increasing"

    return f"{label} differs from its normal pattern"


def build_explanation(
    fault_type: str,
    contributors: list[FeatureContribution],
    risk_score: float = 1.0,
) -> str:
    """
    Build a deterministic explanation from telemetry evidence.
    """

    if fault_type not in {
        "congestion",
        "device_failure",
    }:
        raise ValueError(
            f"Unsupported fault type: {fault_type}"
        )

    if not 0.0 <= risk_score <= 1.0:
        raise ValueError(
            "risk_score must be between 0 and 1"
        )

    if risk_score < 0.4:
        return (
            "No significant fault risk is indicated "
            "by the current telemetry window."
        )

    if not contributors:
        return (
            "The current telemetry pattern indicates "
            f"a risk of {fault_type.replace('_', ' ')}."
        )

    descriptions = [
        _format_feature(contributor)
        for contributor in contributors
    ]

    if len(descriptions) == 1:
        evidence = descriptions[0]
    elif len(descriptions) == 2:
        evidence = (
            f"{descriptions[0]} and {descriptions[1]}"
        )
    else:
        evidence = (
            ", ".join(descriptions[:-1])
            + ", and "
            + descriptions[-1]
        )

    fault_label = fault_type.replace(
        "_",
        " ",
    )

    return (
        f"{evidence}. "
        f"These telemetry patterns indicate a risk "
        f"of {fault_label}."
    )

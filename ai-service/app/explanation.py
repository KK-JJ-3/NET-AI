from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureContribution:
    name: str
    importance: float
    current_value: float
    slope: float


FEATURE_LABELS = {
    "utilization_pct": "network utilization",
    "latency_ms": "latency",
    "packet_loss_pct": "packet loss",
    "jitter_ms": "jitter",
    "cpu_pct": "CPU usage",
    "memory_pct": "memory usage",
    "availability": "availability",
}


def _base_feature_name(
    feature_name: str,
) -> str | None:
    for base_name in FEATURE_LABELS:
        if feature_name.startswith(
            f"{base_name}_"
        ):
            return base_name

    return None


def select_contributors(
    feature_importance: dict[str, float],
    current_features: dict[str, float],
    top_n: int = 3,
) -> list[FeatureContribution]:
    """
    Select the most important unique telemetry metrics.

    Multiple engineered features can belong to the same
    base metric. Only the strongest engineered feature
    for each metric is retained.
    """

    if top_n <= 0:
        raise ValueError(
            "top_n must be greater than 0"
        )

    best_by_metric: dict[
        str,
        FeatureContribution,
    ] = {}

    for feature_name, importance in (
        feature_importance.items()
    ):
        base_name = _base_feature_name(
            feature_name
        )

        if base_name is None:
            continue

        current_value = current_features.get(
            f"{base_name}_current",
            0.0,
        )

        slope = current_features.get(
            f"{base_name}_slope",
            0.0,
        )

        contribution = FeatureContribution(
            name=base_name,
            importance=float(importance),
            current_value=float(
                current_value
            ),
            slope=float(slope),
        )

        existing = best_by_metric.get(
            base_name
        )

        if (
            existing is None
            or contribution.importance
            > existing.importance
        ):
            best_by_metric[
                base_name
            ] = contribution

    contributors = list(
        best_by_metric.values()
    )

    contributors.sort(
        key=lambda item: item.importance,
        reverse=True,
    )

    return contributors[:top_n]


def _format_feature(
    contribution: FeatureContribution,
) -> str:
    label = FEATURE_LABELS.get(
        contribution.name,
        contribution.name,
    )

    if contribution.name == "availability":
        if contribution.current_value < 1.0:
            return f"{label} is degraded"

        return f"{label} is stable"

    if contribution.slope > 0:
        return (
            f"{label} is elevated and increasing"
        )

    if contribution.current_value > 0:
        return f"{label} is elevated"

    return f"{label} is abnormal"


def build_explanation(
    fault_type: str,
    contributors: list[FeatureContribution],
) -> str:
    """
    Build a deterministic explanation from feature evidence.
    """

    if fault_type not in {
        "congestion",
        "device_failure",
    }:
        raise ValueError(
            f"Unsupported fault type: {fault_type}"
        )

    if not contributors:
        return (
            "The telemetry pattern indicates an "
            f"increased risk of "
            f"{fault_type.replace('_', ' ')}."
        )

    descriptions = [
        _format_feature(contributor)
        for contributor in contributors
    ]

    if len(descriptions) == 1:
        evidence = descriptions[0]

    elif len(descriptions) == 2:
        evidence = (
            f"{descriptions[0]} and "
            f"{descriptions[1]}"
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
        f"These telemetry patterns indicate an "
        f"increased risk of {fault_label}."
    )
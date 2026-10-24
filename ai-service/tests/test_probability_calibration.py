from __future__ import annotations

import json

import numpy as np
import pytest

from app.probability_calibration import (
    fit_temperature,
    load_calibration_temperature,
    probabilities_from_logits,
    sha256_file,
)


def test_temperature_scaling_softens_confident_multiclass_logits() -> None:
    logits = np.asarray([[8.0, 1.0, -1.0], [0.2, 4.0, -2.0]])
    raw = probabilities_from_logits(logits, 1.0)
    scaled = probabilities_from_logits(logits, 2.0)

    assert np.allclose(raw.sum(axis=1), 1.0)
    assert np.allclose(scaled.sum(axis=1), 1.0)
    assert np.all(scaled > 0.0)
    assert np.argmax(raw, axis=1).tolist() == np.argmax(scaled, axis=1).tolist()
    assert np.all(np.max(scaled, axis=1) < np.max(raw, axis=1))


def test_temperature_scaling_supports_binary_logits() -> None:
    probabilities = probabilities_from_logits(np.asarray([-2.0, 0.0, 2.0]), 2.0)
    assert probabilities.shape == (3, 2)
    assert np.allclose(probabilities.sum(axis=1), 1.0)
    assert probabilities[0, 1] < 0.5 < probabilities[2, 1]


@pytest.mark.parametrize("temperature", [0.0, -1.0, float("inf"), float("nan")])
def test_invalid_temperature_is_rejected(temperature: float) -> None:
    with pytest.raises(ValueError, match="greater than 0"):
        probabilities_from_logits(np.asarray([[1.0, 2.0]]), temperature)


def test_fit_temperature_returns_positive_finite_value() -> None:
    logits = np.asarray([
        [5.0, 0.0, -1.0], [3.0, 0.0, -1.0],
        [0.0, 4.0, -1.0], [0.0, 3.0, -1.0],
        [0.0, -1.0, 5.0], [0.0, -1.0, 3.0],
    ])
    labels = ["normal", "congestion", "congestion", "device_failure", "device_failure", "normal"]
    temperature = fit_temperature(logits, labels, ["normal", "congestion", "device_failure"])
    assert np.isfinite(temperature)
    assert temperature > 0.0


def test_calibration_artifact_must_match_classifier_hash(tmp_path) -> None:
    model_path = tmp_path / "model.joblib"
    model_path.write_bytes(b"test model")
    calibration_path = tmp_path / "probability_calibration.json"
    calibration_path.write_text(json.dumps({
        "method": "multiclass_temperature_scaling",
        "temperature": 1.8,
        "classifier_sha256": sha256_file(model_path),
    }), encoding="utf-8")

    assert load_calibration_temperature(calibration_path, model_path) == pytest.approx(1.8)
    model_path.write_bytes(b"different model")
    with pytest.raises(ValueError, match="does not match"):
        load_calibration_temperature(calibration_path, model_path)

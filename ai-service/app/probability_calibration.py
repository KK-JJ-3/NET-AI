from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Sequence

import numpy as np
from scipy.optimize import minimize_scalar
from scipy.special import expit, softmax


CALIBRATION_METHOD = "multiclass_temperature_scaling"


def validate_temperature(temperature: float) -> float:
    """Return a finite, strictly positive probability temperature."""
    value = float(temperature)
    if not math.isfinite(value) or value <= 0.0:
        raise ValueError("Probability temperature must be finite and greater than 0.")
    return value


def probabilities_from_logits(logits: np.ndarray, temperature: float) -> np.ndarray:
    """Convert XGBoost margins to probabilities using temperature scaling."""
    value = validate_temperature(temperature)
    margins = np.asarray(logits, dtype=float)
    if margins.ndim not in (1, 2):
        raise ValueError("Classifier logits must be a 1D or 2D array.")
    if margins.shape[0] == 0 or not np.isfinite(margins).all():
        raise ValueError("Classifier logits must be non-empty and finite.")

    if margins.ndim == 1:
        positive_probability = expit(margins / value)
        return np.column_stack((1.0 - positive_probability, positive_probability))

    if margins.shape[1] < 2:
        raise ValueError("Multiclass logits must contain at least two classes.")
    return softmax(margins / value, axis=1)


def fit_temperature(
    logits: np.ndarray,
    labels: Sequence[str],
    classes: Sequence[str],
) -> float:
    """Fit one scalar temperature by minimizing held-out multiclass log loss."""
    margins = np.asarray(logits, dtype=float)
    label_values = np.asarray(labels, dtype=str)
    class_values = tuple(str(value) for value in classes)
    if margins.ndim != 2 or margins.shape[1] != len(class_values):
        raise ValueError("Logit columns must match the supplied class list.")
    if len(label_values) != len(margins) or len(label_values) == 0:
        raise ValueError("Labels must match the non-empty logit rows.")
    if not np.isfinite(margins).all():
        raise ValueError("Classifier logits must be finite.")
    class_indexes = {name: index for index, name in enumerate(class_values)}
    unknown = sorted(set(label_values) - set(class_indexes))
    if unknown:
        raise ValueError(f"Calibration labels contain unknown classes: {unknown}")
    target_indexes = np.asarray([class_indexes[name] for name in label_values], dtype=int)

    def objective(log_temperature: float) -> float:
        temperature = math.exp(float(log_temperature))
        probabilities = probabilities_from_logits(margins, temperature)
        selected = probabilities[np.arange(len(target_indexes)), target_indexes]
        return float(-np.mean(np.log(np.clip(selected, 1e-15, 1.0))))

    result = minimize_scalar(
        objective,
        bounds=(math.log(0.25), math.log(20.0)),
        method="bounded",
        options={"xatol": 1e-4},
    )
    if not result.success or not math.isfinite(float(result.fun)):
        raise RuntimeError("Unable to fit probability temperature.")
    return validate_temperature(math.exp(float(result.x)))


def sha256_file(path: str | Path) -> str:
    """Compute a stable SHA-256 fingerprint for a model artifact."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_calibration_temperature(
    calibration_path: str | Path,
    classifier_path: str | Path,
) -> float:
    """Load calibration only when it was fitted for this exact classifier file."""
    path = Path(calibration_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Probability calibration file not found: {path}. Run "
            "`python -m training.calibrate_probabilities` after training the model."
        )
    with path.open("r", encoding="utf-8") as file:
        artifact = json.load(file)
    if artifact.get("method") != CALIBRATION_METHOD:
        raise ValueError(f"Unsupported probability calibration method in {path}.")
    expected_hash = artifact.get("classifier_sha256")
    actual_hash = sha256_file(classifier_path)
    if not expected_hash or expected_hash != actual_hash:
        raise ValueError(
            "Probability calibration does not match the current XGBoost model. "
            "Run `python -m training.calibrate_probabilities` again."
        )
    return validate_temperature(artifact.get("temperature"))

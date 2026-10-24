from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier


FAULT_CLASSES = ("normal", "congestion", "device_failure")
MODEL_FORMAT_VERSION = 1


class FaultClassifier:
    """XGBoost classifier with a stable string-label API.

    XGBoost trains on integer labels, while the rest of NetFault AI uses the
    class names ``normal``, ``congestion`` and ``device_failure``. This wrapper
    keeps that conversion internal so callers continue to receive string
    labels and probability columns aligned with ``classes()``.
    """

    def __init__(
        self,
        n_estimators: int = 300,
        max_depth: int = 6,
        learning_rate: float = 0.1,
        subsample: float = 0.8,
        colsample_bytree: float = 0.8,
        random_state: int = 42,
    ) -> None:
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.learning_rate = learning_rate
        self.subsample = subsample
        self.colsample_bytree = colsample_bytree
        self.random_state = random_state
        self.model = self._new_model(num_classes=3)
        self._class_labels: tuple[str, ...] = ()
        self.is_fitted = False

    def _new_model(self, num_classes: int) -> XGBClassifier:
        # The project has three classes, but supporting a two-class fit keeps
        # the wrapper predictable for focused unit tests and diagnostics.
        objective = "binary:logistic" if num_classes == 2 else "multi:softprob"
        return XGBClassifier(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            learning_rate=self.learning_rate,
            subsample=self.subsample,
            colsample_bytree=self.colsample_bytree,
            objective=objective,
            eval_metric="mlogloss" if num_classes > 2 else "logloss",
            tree_method="hist",
            random_state=self.random_state,
            n_jobs=4,
        )

    def fit(self, features: np.ndarray, labels: np.ndarray) -> None:
        features = np.asarray(features)
        labels = np.asarray(labels)
        self._validate_training_data(features, labels)

        normalized_labels = np.asarray(
            [str(label).strip().lower() for label in labels],
            dtype=str,
        )
        unknown_labels = sorted(set(normalized_labels) - set(FAULT_CLASSES))
        if unknown_labels:
            raise ValueError(f"Unknown classifier labels: {unknown_labels}")

        observed = set(normalized_labels)
        self._class_labels = tuple(
            label for label in FAULT_CLASSES if label in observed
        )
        label_to_int = {
            label: index for index, label in enumerate(self._class_labels)
        }
        encoded_labels = np.asarray(
            [label_to_int[label] for label in normalized_labels],
            dtype=np.int32,
        )

        self.model = self._new_model(num_classes=len(self._class_labels))
        sample_weights = compute_sample_weight(
            class_weight="balanced",
            y=encoded_labels,
        )
        self.model.fit(
            features,
            encoded_labels,
            sample_weight=sample_weights,
            verbose=False,
        )
        self.is_fitted = True

    def predict(self, features: np.ndarray) -> np.ndarray:
        self._validate_input(features)
        encoded = np.asarray(self.model.predict(features), dtype=int)
        return np.asarray([self._class_labels[index] for index in encoded], dtype=str)

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        self._validate_input(features)
        return self.model.predict_proba(features)

    def classes(self) -> np.ndarray:
        if not self.is_fitted:
            raise RuntimeError("Classifier has not been fitted")
        return np.asarray(self._class_labels, dtype=str)

    def feature_importances(self) -> np.ndarray:
        """Return the trained XGBoost feature importance values."""
        if not self.is_fitted:
            raise RuntimeError("Classifier has not been fitted")
        return np.asarray(self.model.feature_importances_, dtype=float)

    def save(self, path: str | Path) -> None:
        if not self.is_fitted:
            raise RuntimeError("Cannot save an unfitted classifier")

        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "format_version": MODEL_FORMAT_VERSION,
                "model": self.model,
                "class_labels": self._class_labels,
                "configuration": {
                    "n_estimators": self.n_estimators,
                    "max_depth": self.max_depth,
                    "learning_rate": self.learning_rate,
                    "subsample": self.subsample,
                    "colsample_bytree": self.colsample_bytree,
                    "random_state": self.random_state,
                },
            },
            output_path,
        )

    def load(self, path: str | Path) -> None:
        input_path = Path(path)
        if not input_path.exists():
            raise FileNotFoundError(f"Classifier model not found: {input_path}")

        saved: Any = joblib.load(input_path)
        if not isinstance(saved, dict) or saved.get("format_version") != MODEL_FORMAT_VERSION:
            raise TypeError(
                "Saved classifier has an unsupported format. Retrain with "
                "`python -m training.train_models` to create an XGBoost model."
            )

        model = saved.get("model")
        labels = saved.get("class_labels")
        if not isinstance(model, XGBClassifier):
            raise TypeError("Loaded model is not an XGBClassifier")
        if not isinstance(labels, (tuple, list)) or not labels:
            raise TypeError("Saved XGBoost classifier has invalid class labels")
        if any(label not in FAULT_CLASSES for label in labels):
            raise TypeError("Saved XGBoost classifier contains unknown class labels")
        if len(labels) != len(set(labels)):
            raise TypeError("Saved XGBoost classifier contains duplicate class labels")

        self.model = model
        self._class_labels = tuple(str(label) for label in labels)
        config = saved.get("configuration", {})
        for key in (
            "n_estimators", "max_depth", "learning_rate", "subsample",
            "colsample_bytree", "random_state",
        ):
            if key in config:
                setattr(self, key, config[key])
        self.is_fitted = True

    @staticmethod
    def _validate_training_data(features: np.ndarray, labels: np.ndarray) -> None:
        if features.ndim != 2:
            raise ValueError("Features must be a 2D array")
        if features.shape[0] == 0:
            raise ValueError("Features cannot be empty")
        if features.shape[1] == 0:
            raise ValueError("Features cannot have zero columns")
        if labels.ndim != 1:
            raise ValueError("Labels must be a 1D array")
        if features.shape[0] != labels.shape[0]:
            raise ValueError("Number of feature rows must match number of labels")
        if len(np.unique(labels)) < 2:
            raise ValueError("At least 2 classes are required for classifier training")
        if not np.isfinite(features.astype(float)).all():
            raise ValueError("Features must contain only finite numeric values")

    def _validate_input(self, features: np.ndarray) -> None:
        features = np.asarray(features)
        if not self.is_fitted:
            raise RuntimeError("Classifier has not been fitted")
        if features.ndim != 2:
            raise ValueError("Features must be a 2D array")
        if features.shape[1] == 0:
            raise ValueError("Features cannot have zero columns")
        expected = getattr(self.model, "n_features_in_", None)
        if expected is not None and features.shape[1] != expected:
            raise ValueError(
                f"Expected {expected} feature columns, got {features.shape[1]}"
            )
        if not np.isfinite(features.astype(float)).all():
            raise ValueError("Features must contain only finite numeric values")

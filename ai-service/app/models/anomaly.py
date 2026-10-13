from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest


class AnomalyDetector:
    def __init__(
        self,
        contamination: float = 0.05,
        random_state: int = 42,
    ) -> None:
        self.contamination = contamination
        self.random_state = random_state
        self.model = IsolationForest(
            contamination=contamination,
            random_state=random_state,
        )
        self.is_fitted = False

    def fit(self, features: np.ndarray) -> None:
        if features.ndim != 2:
            raise ValueError("Features must be a 2D array")

        if features.shape[0] < 2:
            raise ValueError("At least 2 samples are required for training")

        if features.shape[1] == 0:
            raise ValueError("Features cannot be empty")

        self.model.fit(features)
        self.is_fitted = True

    def anomaly_score(self, features: np.ndarray) -> np.ndarray:
        if not self.is_fitted:
            raise RuntimeError("Anomaly detector has not been fitted")

        if features.ndim != 2:
            raise ValueError("Features must be a 2D array")

        if features.shape[1] == 0:
            raise ValueError("Features cannot be empty")

        # Higher values mean stronger evidence of being anomalous.
        return -self.model.score_samples(features)

    def predict(self, features: np.ndarray) -> np.ndarray:
        if not self.is_fitted:
            raise RuntimeError("Anomaly detector has not been fitted")

        if features.ndim != 2:
            raise ValueError("Features must be a 2D array")

        return self.model.predict(features)

    def save(self, path: str | Path) -> None:
        if not self.is_fitted:
            raise RuntimeError("Cannot save an unfitted anomaly detector")

        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        joblib.dump(self.model, output_path)

    def load(self, path: str | Path) -> None:
        input_path = Path(path)

        if not input_path.exists():
            raise FileNotFoundError(
                f"Anomaly model not found: {input_path}"
            )

        self.model = joblib.load(input_path)

        if not isinstance(self.model, IsolationForest):
            raise TypeError("Loaded model is not an IsolationForest")

        self.is_fitted = True
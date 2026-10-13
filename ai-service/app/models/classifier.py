from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier


class FaultClassifier:
    def __init__(
        self,
        n_estimators: int = 200,
        max_depth: int = 10,
        random_state: int = 42,
    ) -> None:
        self.model = RandomForestClassifier(
            n_estimators=n_estimators,
            max_depth=max_depth,
            class_weight="balanced",
            random_state=random_state,
        )
        self.is_fitted = False

    def fit(
        self,
        features: np.ndarray,
        labels: np.ndarray,
    ) -> None:
        if features.ndim != 2:
            raise ValueError(
                "Features must be a 2D array"
            )

        if features.shape[0] == 0:
            raise ValueError(
                "Features cannot be empty"
            )

        if features.shape[1] == 0:
            raise ValueError(
                "Features cannot have zero columns"
            )

        if labels.ndim != 1:
            raise ValueError(
                "Labels must be a 1D array"
            )

        if features.shape[0] != labels.shape[0]:
            raise ValueError(
                "Number of feature rows must match "
                "number of labels"
            )

        if len(np.unique(labels)) < 2:
            raise ValueError(
                "At least 2 classes are required "
                "for classifier training"
            )

        self.model.fit(
            features,
            labels,
        )

        self.is_fitted = True

    def predict(
        self,
        features: np.ndarray,
    ) -> np.ndarray:
        self._validate_input(
            features
        )

        return self.model.predict(
            features
        )

    def predict_proba(
        self,
        features: np.ndarray,
    ) -> np.ndarray:
        self._validate_input(
            features
        )

        return self.model.predict_proba(
            features
        )

    def classes(self) -> np.ndarray:
        if not self.is_fitted:
            raise RuntimeError(
                "Classifier has not been fitted"
            )

        return self.model.classes_

    def feature_importances(self) -> np.ndarray:
        """Return the trained Random Forest feature importances."""

        if not self.is_fitted:
            raise RuntimeError(
                "Classifier has not been fitted"
            )

        return self.model.feature_importances_

    def save(
        self,
        path: str | Path,
    ) -> None:
        if not self.is_fitted:
            raise RuntimeError(
                "Cannot save an unfitted classifier"
            )

        output_path = Path(path)

        output_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        joblib.dump(
            self.model,
            output_path,
        )

    def load(
        self,
        path: str | Path,
    ) -> None:
        input_path = Path(path)

        if not input_path.exists():
            raise FileNotFoundError(
                f"Classifier model not found: "
                f"{input_path}"
            )

        self.model = joblib.load(
            input_path
        )

        if not isinstance(
            self.model,
            RandomForestClassifier,
        ):
            raise TypeError(
                "Loaded model is not a "
                "RandomForestClassifier"
            )

        self.is_fitted = True

    def _validate_input(
        self,
        features: np.ndarray,
    ) -> None:
        if not self.is_fitted:
            raise RuntimeError(
                "Classifier has not been fitted"
            )

        if features.ndim != 2:
            raise ValueError(
                "Features must be a 2D array"
            )

        if features.shape[1] == 0:
            raise ValueError(
                "Features cannot have zero columns"
            )
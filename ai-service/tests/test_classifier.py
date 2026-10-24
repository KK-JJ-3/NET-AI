from __future__ import annotations

import numpy as np
import pytest
from xgboost import XGBClassifier

from app.models.classifier import FaultClassifier


def sample_data() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(7)
    features = np.vstack(
        [
            rng.normal(loc=-2.0, scale=0.25, size=(18, 4)),
            rng.normal(loc=0.0, scale=0.25, size=(18, 4)),
            rng.normal(loc=2.0, scale=0.25, size=(18, 4)),
        ]
    ).astype(float)
    labels = np.asarray(
        ["normal"] * 18 + ["congestion"] * 18 + ["device_failure"] * 18,
        dtype=str,
    )
    return features, labels


def make_classifier() -> FaultClassifier:
    return FaultClassifier(
        n_estimators=12,
        max_depth=3,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=11,
    )


def test_fit_returns_named_classes_and_valid_probabilities() -> None:
    features, labels = sample_data()
    classifier = make_classifier()
    classifier.fit(features, labels)

    assert isinstance(classifier.model, XGBClassifier)
    assert classifier.classes().tolist() == [
        "normal", "congestion", "device_failure"
    ]
    assert set(classifier.predict(features)) <= set(labels)

    probabilities = classifier.predict_proba(features)
    assert probabilities.shape == (len(features), 3)
    assert np.isfinite(probabilities).all()
    assert np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-5)
    assert classifier.feature_importances().shape == (features.shape[1],)


def test_save_and_load_preserves_labels_and_probabilities(tmp_path) -> None:
    features, labels = sample_data()
    classifier = make_classifier()
    classifier.fit(features, labels)
    expected = classifier.predict_proba(features[:5])

    model_path = tmp_path / "nested" / "classifier.joblib"
    classifier.save(model_path)

    loaded = FaultClassifier()
    loaded.load(model_path)

    assert loaded.classes().tolist() == classifier.classes().tolist()
    assert loaded.predict(features[:5]).tolist() == classifier.predict(features[:5]).tolist()
    assert np.allclose(loaded.predict_proba(features[:5]), expected)


def test_unknown_labels_are_rejected() -> None:
    features, labels = sample_data()
    labels[0] = "unexpected_fault"
    with pytest.raises(ValueError, match="Unknown classifier labels"):
        make_classifier().fit(features, labels)


def test_feature_count_mismatch_is_rejected() -> None:
    features, labels = sample_data()
    classifier = make_classifier()
    classifier.fit(features, labels)
    with pytest.raises(ValueError, match="Expected 4 feature columns"):
        classifier.predict(features[:, :3])

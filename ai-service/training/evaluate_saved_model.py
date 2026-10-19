from __future__ import annotations

import json


from app.models.anomaly import AnomalyDetector
from app.models.classifier import FaultClassifier
from training.prepare import prepare_dataset
from training.train_models import (
    ANOMALY_CONTAMINATION,
    ANOMALY_MODEL_PATH,
    CLASSIFIER_MODEL_PATH,
    EPISODE_DURATION_MINUTES,
    EPISODES_PER_CLASS,
    FUTURE_HORIZON_MINUTES,
    RANDOM_SEED,
    WINDOW_SIZE,
    evaluate_model,
    normalize_labels,
)


def main() -> None:
    """Evaluate existing saved models without retraining or overwriting them."""
    for path in (ANOMALY_MODEL_PATH, CLASSIFIER_MODEL_PATH):
        if not path.exists():
            raise FileNotFoundError(
                f"Required saved model was not found: {path}\n"
                "Run `python -m training.train_models` first."
            )

    print("Preparing the same deterministic held-out dataset...")
    print(f"Episodes per class: {EPISODES_PER_CLASS}")
    print(f"Forecast horizon: {FUTURE_HORIZON_MINUTES} minutes")
    print(f"Telemetry window: {WINDOW_SIZE} readings")

    _, x_test, _, y_test = prepare_dataset(
        random_seed=RANDOM_SEED,
        window_size=WINDOW_SIZE,
        future_horizon_minutes=FUTURE_HORIZON_MINUTES,
        duration_minutes=EPISODE_DURATION_MINUTES,
        episodes_per_class=EPISODES_PER_CLASS,
    )
    y_test = normalize_labels(y_test)

    anomaly_detector = AnomalyDetector(
        contamination=ANOMALY_CONTAMINATION,
        random_state=RANDOM_SEED,
    )
    anomaly_detector.load(ANOMALY_MODEL_PATH)

    classifier = FaultClassifier(
        random_state=RANDOM_SEED,
    )
    classifier.load(CLASSIFIER_MODEL_PATH)

    test_array = x_test.to_numpy(dtype=float)
    anomaly_scores = anomaly_detector.anomaly_score(test_array)
    x_test_with_anomaly = x_test.copy()
    x_test_with_anomaly["anomaly_score"] = anomaly_scores

    expected_feature_count = getattr(
        classifier.model,
        "n_features_in_",
        None,
    )
    if (
        expected_feature_count is not None
        and expected_feature_count != x_test_with_anomaly.shape[1]
    ):
        raise ValueError(
            "Saved classifier feature count does not match the regenerated "
            f"dataset: model expects {expected_feature_count}, but generated "
            f"{x_test_with_anomaly.shape[1]}. Make sure this dataset and the "
            "saved models come from the same training version."
        )

    results = evaluate_model(
        classifier=classifier,
        x_test=x_test_with_anomaly,
        y_test=y_test,
    )

    print("\nSAVED-MODEL EVALUATION (NO RETRAINING)")
    print("-------------------------------------")
    print(f"Test samples: {results['test_samples']}")
    print(f"Decision rule: {results['evaluation_decision_rule']}")
    print(f"Fault risk threshold: {results['fault_risk_threshold']}")
    print(f"Accuracy: {results['accuracy_percent']}%")
    print(
        "Normal false-positive rate: "
        f"{results['normal_false_positive_rate_percent']}%"
    )
    print(f"Normal false positives: {results['normal_false_positives']}")
    print(f"Future fault samples: {results['future_fault_samples']}")
    print(f"Missed future faults: {results['missed_future_faults']}")
    print("\nClassification report:")
    print(json.dumps(results["classification_report"], indent=2))
    print("\nConfusion matrix (rows=actual, columns=predicted):")
    print(json.dumps(results["confusion_matrix"], indent=2))
    print(
        "\nExisting model files and evaluation_results.json were not modified."
    )


if __name__ == "__main__":
    main()

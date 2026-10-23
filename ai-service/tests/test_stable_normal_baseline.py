from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from training import train_models


def test_baseline_uses_only_eligible_stable_normal_rows(tmp_path, monkeypatch):
    destination = tmp_path / "normal_baseline.json"
    monkeypatch.setattr(train_models, "NORMAL_BASELINE_PATH", destination)

    features = pd.DataFrame({"latency_ms_current": [10.0, 1000.0, 30.0],
                             "anomaly_score": [0.1, 0.9, 0.2]})
    labels = pd.Series(["normal", "normal", "congestion"])
    eligible = pd.Series([True, False, True])

    train_models.save_normal_baseline(features, labels, eligible)
    baseline = json.loads(destination.read_text(encoding="utf-8"))

    assert baseline["latency_ms_current"] == 10.0
    assert baseline["anomaly_score"] == 0.1


def test_baseline_rejects_mask_with_wrong_length(tmp_path, monkeypatch):
    monkeypatch.setattr(train_models, "NORMAL_BASELINE_PATH", tmp_path / "baseline.json")
    features = pd.DataFrame({"latency_ms_current": [10.0, 20.0]})
    labels = pd.Series(["normal", "normal"])

    with pytest.raises(ValueError, match="mask length"):
        train_models.save_normal_baseline(features, labels, np.array([True]))


def test_baseline_rejects_when_no_stable_normal_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(train_models, "NORMAL_BASELINE_PATH", tmp_path / "baseline.json")
    features = pd.DataFrame({"latency_ms_current": [10.0, 20.0]})
    labels = pd.Series(["normal", "congestion"])

    with pytest.raises(ValueError, match="stable healthy"):
        train_models.save_normal_baseline(features, labels, pd.Series([False, True]))

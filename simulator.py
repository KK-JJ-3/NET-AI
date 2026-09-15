"""
Network Fault Simulator
Generates synthetic network telemetry.

Run:
    python simulator.py

Output:
    data/simulated_network_data.csv
"""

import os
import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)

FAULTS = [
    "normal",
    "link_failure",
    "congestion",
    "hardware_degradation",
    "latency_spike",
    "packet_loss",
    "ddos_like_anomaly"
]


def make_row(fault="normal"):

    # -----------------------------
    # Normal network conditions
    # -----------------------------
    latency = max(2, RNG.normal(25, 6))
    packet_loss = max(0, RNG.normal(0.3, 0.2))
    bandwidth = np.clip(RNG.normal(55, 12), 5, 100)
    cpu = np.clip(RNG.normal(42, 12), 5, 100)
    memory = np.clip(RNG.normal(48, 10), 5, 100)
    throughput = np.clip(RNG.normal(55, 12), 1, 100)
    jitter = max(0.5, RNG.normal(4, 1.5))
    errors = max(0, RNG.normal(3, 2))
    connections = max(1, RNG.normal(350, 80))
    temperature = np.clip(RNG.normal(45, 5), 20, 90)
    signal = np.clip(RNG.normal(85, 5), 20, 100)

    # -----------------------------
    # Fault patterns
    # -----------------------------

    if fault == "link_failure":

        throughput *= RNG.uniform(0.05, 0.25)
        packet_loss += RNG.uniform(8, 30)
        latency += RNG.uniform(40, 120)
        errors += RNG.uniform(20, 80)

    elif fault == "congestion":

        bandwidth = np.clip(
            RNG.normal(92, 5),
            65,
            100
        )

        throughput = np.clip(
            RNG.normal(90, 6),
            65,
            100
        )

        cpu += RNG.uniform(20, 45)
        latency += RNG.uniform(30, 90)
        jitter += RNG.uniform(8, 25)
        connections += RNG.uniform(200, 800)

    elif fault == "hardware_degradation":

        temperature += RNG.uniform(15, 35)
        cpu += RNG.uniform(10, 30)
        memory += RNG.uniform(5, 20)
        errors += RNG.uniform(10, 40)
        signal -= RNG.uniform(10, 30)

    elif fault == "latency_spike":

        latency += RNG.uniform(100, 450)
        jitter += RNG.uniform(20, 80)

    elif fault == "packet_loss":

        packet_loss += RNG.uniform(5, 25)
        errors += RNG.uniform(10, 50)
        jitter += RNG.uniform(5, 20)

    elif fault == "ddos_like_anomaly":

        connections += RNG.uniform(1500, 6000)

        throughput = np.clip(
            RNG.normal(98, 2),
            85,
            100
        )

        cpu += RNG.uniform(35, 55)

        bandwidth = np.clip(
            RNG.normal(98, 2),
            85,
            100
        )

        errors += RNG.uniform(15, 50)

    # -----------------------------
    # Create row
    # -----------------------------

    values = {

        "latency_ms": latency,

        "packet_loss_pct": packet_loss,

        "bandwidth_utilization_pct": bandwidth,

        "cpu_utilization_pct": np.clip(cpu, 0, 100),

        "memory_utilization_pct": np.clip(memory, 0, 100),

        "throughput_mbps": throughput,

        "jitter_ms": jitter,

        "error_rate": errors,

        "active_connections": connections,

        "temperature_c": temperature,

        "signal_strength_pct": np.clip(signal, 0, 100)
    }

    # -----------------------------
    # Future fault prediction label
    # -----------------------------

    fault_probability = 0.08

    if fault != "normal":

        fault_probability = 0.90

    else:

        score = (

            (values["latency_ms"] > 55)

            + (values["packet_loss_pct"] > 2)

            + (values["cpu_utilization_pct"] > 75)

            + (values["temperature_c"] > 60)

            + (values["error_rate"] > 10)
        )

        fault_probability += 0.12 * score

    values["future_fault_5min"] = int(
        RNG.random() < min(fault_probability, 0.98)
    )

    values["fault_type"] = fault

    return values


def generate(n=10000):

    rows = []

    probabilities = [
        0.55,  # normal
        0.08,  # link failure
        0.08,  # congestion
        0.07,  # hardware degradation
        0.08,  # latency spike
        0.07,  # packet loss
        0.07   # ddos-like anomaly
    ]

    chosen_faults = RNG.choice(
        FAULTS,
        size=n,
        p=probabilities
    )

    for fault in chosen_faults:

        rows.append(
            make_row(fault)
        )

    df = pd.DataFrame(rows)

    df.insert(
        0,
        "timestamp",
        pd.date_range(
            "2026-01-01",
            periods=n,
            freq="min"
        )
    )

    df.insert(
        1,
        "node_id",
        RNG.choice(
            [f"NODE-{i:03d}" for i in range(1, 21)],
            n
        )
    )

    return df


if __name__ == "__main__":

    output_dir = os.path.join(
        os.path.dirname(__file__),
        "data"
    )

    os.makedirs(
        output_dir,
        exist_ok=True
    )

    df = generate(10000)

    output_path = os.path.join(
        output_dir,
        "simulated_network_data.csv"
    )

    df.to_csv(
        output_path,
        index=False
    )

    print(
        f"Created {len(df):,} rows"
    )

    print(
        f"Saved to: {output_path}"
    )

    print("\nFault distribution:")

    print(
        df["fault_type"].value_counts()
    )
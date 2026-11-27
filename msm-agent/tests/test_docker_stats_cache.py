"""Proof tests for MSM Agent container_stats 4s TTL cache, singleflight & one_shot delta."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import time

import pytest

from services import docker_service


def test_agent_container_stats_singleflight_cache_and_oneshot(monkeypatch: pytest.MonkeyPatch) -> None:
    docker_service.clear_stats_cache()
    calls: list[dict] = []
    payloads = [
        {
            "cpu_stats": {
                "cpu_usage": {"total_usage": 2_000_000_000},
                "system_cpu_usage": 20_000_000_000,
                "online_cpus": 2,
            },
            "precpu_stats": {
                "cpu_usage": {"total_usage": 1_000_000_000},
                "system_cpu_usage": 10_000_000_000,
            },
            "memory_stats": {"usage": 256 * 1024 * 1024},
            "networks": {"eth0": {"rx_bytes": 100, "tx_bytes": 200}},
        },
        {
            "cpu_stats": {
                "cpu_usage": {"total_usage": 2_500_000_000},
                "system_cpu_usage": 22_000_000_000,
                "online_cpus": 2,
            },
            "precpu_stats": {},
            "memory_stats": {"usage": 384 * 1024 * 1024},
            "networks": {"eth0": {"rx_bytes": 300, "tx_bytes": 400}},
        },
    ]

    class FakeContainer:
        status = "running"

        def reload(self) -> None:
            return None

        def stats(self, *, stream=False, one_shot=False):
            calls.append({"stream": stream, "one_shot": one_shot})
            time.sleep(0.03)
            return payloads[min(len(calls) - 1, len(payloads) - 1)]

    fake = FakeContainer()
    monkeypatch.setattr(docker_service, "_get_container", lambda _name: fake)

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(lambda _i: docker_service.container_stats("msm-srv-7"), range(20)))

    assert len(calls) == 1
    assert calls[0] == {"stream": False, "one_shot": False}
    assert all(r["cpu_percent"] == 20.0 and r["ram_mb"] == 256 for r in results)

    t_hit = time.monotonic()
    hit = docker_service.container_stats("msm-srv-7")
    assert (time.monotonic() - t_hit) < 0.05
    assert hit["ram_mb"] == 256
    assert len(calls) == 1

    # Expire TTL -> one_shot=True delta (2.5e9 - 2.0e9) / (22e9 - 20e9) * 2 * 100 = 50.0%
    with docker_service._stats_cache_lock:
        old_val = docker_service._stats_cache["msm-srv-7"][1]
        docker_service._stats_cache["msm-srv-7"] = (time.monotonic() - 1.0, old_val)

    second = docker_service.container_stats("msm-srv-7")
    assert len(calls) == 2
    assert calls[1] == {"stream": False, "one_shot": True}
    assert second["cpu_percent"] == 50.0
    assert second["ram_mb"] == 384
    assert second["network_rx_bytes"] == 300

    docker_service.clear_stats_cache("msm-srv-7")
    with docker_service._stats_cache_lock:
        assert "msm-srv-7" not in docker_service._stats_cache
        assert "msm-srv-7" not in docker_service._stats_prev_cpu

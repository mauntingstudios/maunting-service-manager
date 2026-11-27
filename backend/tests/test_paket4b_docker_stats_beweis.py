"""Wirksamkeitsbeweis für Paket 4B: Docker-Stats TTL-Cache (4s), Singleflight & one_shot-Delta."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import time
from types import SimpleNamespace

import pytest

from services import docker_service


def test_stats_singleflight_ttl_cache_and_oneshot_delta(monkeypatch: pytest.MonkeyPatch) -> None:
    docker_service.clear_stats_cache()
    calls: list[dict] = []
    # Sequenz: 1. Sample (stream=False), 2. Sample (one_shot=True nach Ablauf TTL)
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
            "memory_stats": {"usage": 512 * 1024 * 1024},
        },
        {
            "cpu_stats": {
                "cpu_usage": {"total_usage": 2_500_000_000},
                "system_cpu_usage": 22_000_000_000,
                "online_cpus": 2,
            },
            "precpu_stats": {},
            "memory_stats": {"usage": 640 * 1024 * 1024},
        },
    ]

    class FakeContainer:
        status = "running"

        def stats(self, *, stream=False, one_shot=False):
            calls.append({"stream": stream, "one_shot": one_shot})
            time.sleep(0.03)
            return payloads[min(len(calls) - 1, len(payloads) - 1)]

    fake = FakeContainer()
    monkeypatch.setattr(docker_service, "_container", lambda _name: fake)

    # 1. 20 parallele Abrufe -> exakt 1 Docker-Call (Singleflight + 4s-Cache)
    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(lambda _i: docker_service.stats("msm-srv-42"), range(20)))
    elapsed = time.monotonic() - t0

    assert len(calls) == 1
    assert calls[0] == {"stream": False, "one_shot": False}
    assert elapsed < 0.5
    assert all(r == {"cpu_percent": 20.0, "ram_mb": 512} for r in results)

    # Cache-Hit liegt klar unter 50ms
    t_hit = time.monotonic()
    hit = docker_service.stats("msm-srv-42")
    assert (time.monotonic() - t_hit) < 0.05
    assert hit == {"cpu_percent": 20.0, "ram_mb": 512}
    assert len(calls) == 1

    # 2. Nach Cache-Ablauf -> one_shot=True und CPU-Delta gegen Vorwert im RAM:
    # (2.5e9 - 2.0e9) / (22.0e9 - 20.0e9) * 2 * 100 = 0.5/2.0 * 200 = 50.0%
    key = docker_service._stats_cache_key("msm-srv-42", None)
    with docker_service._stats_cache_lock:
        old_val = docker_service._stats_cache[key][1]
        docker_service._stats_cache[key] = (time.monotonic() - 1.0, old_val)

    second = docker_service.stats("msm-srv-42")
    assert len(calls) == 2
    assert calls[1] == {"stream": False, "one_shot": True}
    assert second == {"cpu_percent": 50.0, "ram_mb": 640}

    # 3. Invalidierung über clear_stats_cache erzwingt frischen Sample ohne prev
    docker_service.clear_stats_cache("msm-srv-42")
    with docker_service._stats_cache_lock:
        assert key not in docker_service._stats_cache
        assert key not in docker_service._stats_prev_cpu

    # 4. TypeError bei Legacy-Mock ohne one_shot-Parameter fällt sauber zurück
    class LegacyMockContainer:
        status = "running"

        def stats(self, *, stream=False):
            return payloads[0]

    monkeypatch.setattr(docker_service, "_container", lambda _name: LegacyMockContainer())
    with docker_service._stats_cache_lock:
        docker_service._stats_prev_cpu[key] = (1_000_000_000, 10_000_000_000)
    fallback = docker_service.stats("msm-srv-42")
    assert fallback == {"cpu_percent": 20.0, "ram_mb": 512}
    docker_service.clear_stats_cache()

"""Metriken-Endpunkt und interne Metrik-Sammlung (Hardening WP1.4 & 1.5).

Stellt Metriken im Plain-Text-Prometheus-Format bereit:
- http_requests_total
- http_request_duration_seconds (Summe, Anzahl, Histogramm-Buckets)
- db_pool_size, checkedin, checkedout, overflow
"""

from collections import defaultdict
import threading
import time
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from database import engine
from dependencies import require_global


_lock = threading.Lock()
_request_counts: Dict[Tuple[str, str, int], int] = defaultdict(int)
_request_duration_sum: Dict[Tuple[str, str], float] = defaultdict(float)
_request_duration_count: Dict[Tuple[str, str], int] = defaultdict(int)

# Histogram Buckets in Sekunden
_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
_bucket_counts: Dict[Tuple[str, str, float], int] = defaultdict(int)


def record_request_metrics(method: str, path: str, status_code: int, duration_seconds: float) -> None:
    """Zeichnet Request-Metriken thread-sicher auf."""
    # Pfad normalisieren, um Kardinalitäts-Explosion zu verhindern
    # Z.B. /api/servers/123 -> /api/servers/{id} oder Prefix
    path_key = _normalize_path(path)
    with _lock:
        _request_counts[(method, path_key, status_code)] += 1
        _request_duration_sum[(method, path_key)] += duration_seconds
        _request_duration_count[(method, path_key)] += 1
        for b in _BUCKETS:
            if duration_seconds <= b:
                _bucket_counts[(method, path_key, b)] += 1


def _normalize_path(path: str) -> str:
    """Gruppiert dynamische ID-Segmente im Pfad zur Begrenzung der Kardinalität."""
    parts = path.strip("/").split("/")
    norm = []
    for p in parts:
        if p.isdigit():
            norm.append("{id}")
        elif len(p) >= 32 and all(c in "0123456789abcdefABCDEF-" for c in p):
            norm.append("{uuid}")
        else:
            norm.append(p)
    return "/" + "/".join(norm) if norm else "/"


def get_db_pool_stats() -> Dict[str, int]:
    """Liest den aktuellen Zustand des SQLAlchemy Connection-Pools aus."""
    pool = getattr(engine, "pool", None)
    if not pool:
        return {}
    stats: Dict[str, int] = {}
    try:
        if hasattr(pool, "size"):
            stats["size"] = pool.size()
        if hasattr(pool, "checkedin"):
            stats["checkedin"] = pool.checkedin()
        if hasattr(pool, "checkedout"):
            stats["checkedout"] = pool.checkedout()
        if hasattr(pool, "overflow"):
            stats["overflow"] = pool.overflow()
    except Exception:
        pass
    return stats


_sidecar_duration_sum = 0.0
_sidecar_duration_count = 0
_sidecar_last_latency = 0.0


def record_sidecar_metrics(duration_seconds: float) -> None:
    """Zeichnet Latenz-Metriken für Aufrufe an den DIS-Sidecar auf."""
    global _sidecar_duration_sum, _sidecar_duration_count, _sidecar_last_latency
    with _lock:
        _sidecar_duration_sum += duration_seconds
        _sidecar_duration_count += 1
        _sidecar_last_latency = duration_seconds


def get_queue_depth_stats() -> Dict[str, int]:
    """Liest die Anzahl ausstehender Aufgaben aus der Datenbank."""
    stats = {"operation_tasks_queued": 0, "operation_tasks_running": 0}
    try:
        from database import SessionLocal
        from models.operation_task import OperationTask
        from sqlalchemy import func

        with SessionLocal() as db:
            rows = (
                db.query(OperationTask.status, func.count(OperationTask.id))
                .filter(OperationTask.status.in_(["queued", "running"]))
                .group_by(OperationTask.status)
                .all()
            )
            for status, count in rows:
                if status == "queued":
                    stats["operation_tasks_queued"] = count
                elif status == "running":
                    stats["operation_tasks_running"] = count
    except Exception:
        pass
    return stats


def generate_prometheus_metrics() -> str:
    """Formatiert die gesammelten Metriken als Prometheus-kompatiblen Text."""
    lines: List[str] = [
        "# HELP http_requests_total Gesamtzahl der HTTP-Anfragen.",
        "# TYPE http_requests_total counter",
    ]
    with _lock:
        for (m, p, s), c in sorted(_request_counts.items()):
            lines.append(f'http_requests_total{{method="{m}",path="{p}",status="{s}"}} {c}')

        lines.append("# HELP http_request_duration_seconds Dauer der HTTP-Anfragen in Sekunden.")
        lines.append("# TYPE http_request_duration_seconds histogram")
        for (m, p), count in sorted(_request_duration_count.items()):
            for b in _BUCKETS:
                bucket_val = _bucket_counts.get((m, p, b), 0)
                lines.append(f'http_request_duration_seconds_bucket{{method="{m}",path="{p}",le="{b}"}} {bucket_val}')
            lines.append(f'http_request_duration_seconds_bucket{{method="{m}",path="{p}",le="+Inf"}} {count}')
            d_sum = _request_duration_sum.get((m, p), 0.0)
            lines.append(f'http_request_duration_seconds_sum{{method="{m}",path="{p}"}} {d_sum:.6f}')
            lines.append(f'http_request_duration_seconds_count{{method="{m}",path="{p}"}} {count}')

        s_count = _sidecar_duration_count
        s_sum = _sidecar_duration_sum
        s_last = _sidecar_last_latency

    # Sidecar Metriken
    lines.append("# HELP sidecar_request_duration_seconds Dauer der Anfragen an den DIS-Sidecar in Sekunden.")
    lines.append("# TYPE sidecar_request_duration_seconds summary")
    lines.append(f'sidecar_request_duration_seconds_sum {s_sum:.6f}')
    lines.append(f'sidecar_request_duration_seconds_count {s_count}')
    lines.append("# HELP sidecar_latency_seconds Letzte gemessene Latenz des DIS-Sidecars in Sekunden.")
    lines.append("# TYPE sidecar_latency_seconds gauge")
    lines.append(f'sidecar_latency_seconds {s_last:.6f}')

    # Queue-Tiefe Metriken
    q_stats = get_queue_depth_stats()
    lines.append("# HELP queue_depth Aktuelle Anzahl der Aufgaben in den Warteschlangen.")
    lines.append("# TYPE queue_depth gauge")
    for q_name, val in sorted(q_stats.items()):
        lines.append(f'queue_depth{{queue="{q_name}"}} {val}')

    # DB Pool Metriken
    pool_stats = get_db_pool_stats()
    if pool_stats:
        lines.append("# HELP db_pool_connections Verbindungsstatistiken des Datenbankpools.")
        lines.append("# TYPE db_pool_connections gauge")
        for state, val in pool_stats.items():
            lines.append(f'db_pool_connections{{state="{state}"}} {val}')

    return "\n".join(lines) + "\n"


router = APIRouter(tags=["Metrics"])


@router.get("/api/metrics", response_class=PlainTextResponse, include_in_schema=False)
def get_metrics(_: object = Depends(require_global("panel.settings.read"))) -> str:
    """Gibt Metriken der Anwendung im Prometheus-Textformat zurück."""
    return generate_prometheus_metrics()

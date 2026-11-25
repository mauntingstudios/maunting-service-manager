"""MSM Hoster API client implemented strictly from docs/hoster-api.md & docs/de-docs/hoster-api.md."""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any
from urllib.parse import quote

import httpx


class HosterApiError(RuntimeError):
    """Raised when MSM Hoster API returns a non-2xx HTTP status."""

    def __init__(self, status_code: int, detail: Any) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"MSM Hoster API HTTP {status_code}: {detail}")


def verify_msm_webhook(
    *,
    secret: str,
    raw_body: bytes,
    timestamp_header: str,
    signature_header: str,
    tolerance_seconds: int = 300,
    now_ts: float | None = None,
) -> bool:
    """Verify HMAC-SHA256 `{timestamp}.{raw_body}` signature and replay window."""
    if not secret or not timestamp_header or not signature_header:
        return False
    if not timestamp_header.isdigit():
        return False
    current = time.time() if now_ts is None else now_ts
    if abs(current - int(timestamp_header)) > tolerance_seconds:
        return False

    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        f"{timestamp_header}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)


class MsmHosterClient:
    """Server-to-server HTTP client for `/api/hoster/v1/*`."""

    def __init__(self, panel_url: str, api_key: str, timeout: float = 30.0) -> None:
        normalized_url = panel_url.strip().rstrip("/")
        if not normalized_url.startswith(("https://", "http://")):
            raise ValueError("panel_url must start with https:// or http://")
        self.base_url = normalized_url
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {
            "X-MSM-Hoster-Key": self.api_key,
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    @staticmethod
    def _parse_response(resp: httpx.Response) -> Any:
        try:
            body = resp.json()
        except ValueError:
            body = resp.text
        if resp.status_code >= 400:
            raise HosterApiError(resp.status_code, body)
        return body

    async def health(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/hoster/v1/health",
                headers={"X-MSM-Hoster-Key": self.api_key},
            )
            return self._parse_response(resp)

    async def get_catalog(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/hoster/v1/catalog",
                headers={"X-MSM-Hoster-Key": self.api_key},
            )
            return self._parse_response(resp)

    async def apply(
        self,
        *,
        external_subject: str,
        desired_state: str,
        items: list[dict[str, Any]],
        email: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "external_subject": external_subject,
            "desired_state": desired_state,
            "items": items,
        }
        if email:
            payload["email"] = email
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/hoster/v1/apply",
                headers=self._headers(idempotency_key=idempotency_key),
                json=payload,
            )
            return self._parse_response(resp)

    async def put_service(
        self,
        external_service_id: str,
        *,
        desired_state: str,
        external_subject: str,
        plan_id: int | None = None,
        product_key: str | None = None,
        ram_mb: int | None = None,
        cpu_percent: int | None = None,
        slots: int | None = None,
        variables: dict[str, str] | None = None,
        email: str | None = None,
        purge_immediately: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "desired_state": desired_state,
            "external_subject": external_subject,
        }
        if plan_id is not None:
            payload["plan_id"] = plan_id
        if product_key is not None:
            payload["product_key"] = product_key
        if ram_mb is not None:
            payload["ram_mb"] = ram_mb
        if cpu_percent is not None:
            payload["cpu_percent"] = cpu_percent
        if slots is not None:
            payload["slots"] = slots
        if variables is not None:
            payload["variables"] = variables
        if email is not None:
            payload["email"] = email
        if purge_immediately:
            payload["purge_immediately"] = True

        svc_path = quote(external_service_id, safe="")
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.put(
                f"{self.base_url}/api/hoster/v1/services/{svc_path}",
                headers=self._headers(),
                json=payload,
            )
            return self._parse_response(resp)

    async def get_service(self, external_service_id: str) -> dict[str, Any]:
        svc_path = quote(external_service_id, safe="")
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/hoster/v1/services/{svc_path}",
                headers={"X-MSM-Hoster-Key": self.api_key},
            )
            return self._parse_response(resp)

    async def create_handoff(
        self,
        *,
        external_service_id: str,
        target_path: str = "/servers",
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/hoster/v1/handoffs",
                headers=self._headers(),
                json={
                    "external_service_id": external_service_id,
                    "target_path": target_path,
                },
            )
            return self._parse_response(resp)

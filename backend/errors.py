"""Globaler Fehlervertrag für das MSM-Backend (Hardening WP1.3).

Standardisiert Fehlercodes über StrEnum und stellt die problem()-Hilfsfunktion
bereit, die FastAPI/Starlette HTTPException mit standardisiertem Detail-Objekt erzeugt.
"""

from enum import Enum
from typing import Any, Dict, Optional
from fastapi import HTTPException


class ErrorCode(str, Enum):
    AUTH_REQUIRED = "auth_required"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    VALIDATION_FAILED = "validation_failed"
    RATE_LIMITED = "rate_limited"
    INTERNAL = "internal"
    UNAVAILABLE = "unavailable"


STATUS_CODE_MAP: Dict[int, ErrorCode] = {
    400: ErrorCode.VALIDATION_FAILED,
    401: ErrorCode.AUTH_REQUIRED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    409: ErrorCode.CONFLICT,
    413: ErrorCode.PAYLOAD_TOO_LARGE,
    422: ErrorCode.VALIDATION_FAILED,
    429: ErrorCode.RATE_LIMITED,
    500: ErrorCode.INTERNAL,
    502: ErrorCode.UNAVAILABLE,
    503: ErrorCode.UNAVAILABLE,
    504: ErrorCode.UNAVAILABLE,
}


def status_to_error_code(status_code: int) -> ErrorCode:
    return STATUS_CODE_MAP.get(status_code, ErrorCode.INTERNAL)


class ProblemException(HTTPException):
    """Spezifische HTTPException für den einheitlichen MSM-Fehlervertrag."""

    def __init__(
        self,
        code: ErrorCode | str,
        status: int,
        message: str,
        headers: Optional[Dict[str, str]] = None,
    ):
        code_str = code.value if isinstance(code, ErrorCode) else str(code)
        super().__init__(
            status_code=status,
            detail={"code": code_str, "message": message},
            headers=headers,
        )


def problem(
    code: ErrorCode | str,
    status: int,
    message: str,
    headers: Optional[Dict[str, str]] = None,
) -> ProblemException:
    """Erzeugt eine HTTPException mit dem einheitlichen MSM-Fehlervertrag.

    Format: detail = {"code": "<code_string>", "message": "<message_string>"}
    """
    return ProblemException(
        code=code,
        status=status,
        message=message,
        headers=headers,
    )

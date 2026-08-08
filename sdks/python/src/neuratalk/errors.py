from __future__ import annotations

from typing import Any, Optional


class NeuraTalkApiError(Exception):
    """Raised for any non-2xx NeuraTalk API response.

    ``body`` is the parsed JSON error payload — its shape varies by module
    (there is no single error envelope across the API: auth returns
    ``{message}``/``{success, message}``, calls/transcripts return
    ``{error}``). Check defensively rather than assuming one shape.
    """

    def __init__(self, status: int, body: Any):
        self.status = status
        self.body = body
        super().__init__(self._extract_message(body) or f"Request failed with status {status}")

    @staticmethod
    def _extract_message(body: Any) -> Optional[str]:
        if isinstance(body, dict):
            if isinstance(body.get("message"), str):
                return body["message"]
            if isinstance(body.get("error"), str):
                return body["error"]
        return None


class NeuraTalkNetworkError(Exception):
    def __init__(self, cause: BaseException):
        self.cause = cause
        super().__init__(f"Network error while calling the NeuraTalk API: {cause}")

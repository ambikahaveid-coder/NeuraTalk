from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import requests

from .errors import NeuraTalkApiError, NeuraTalkNetworkError

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class NeuraTalkClient:
    """Official NeuraTalk API client.

    Auth endpoints (``register``/``login``/``request_otp``/``verify_otp``)
    don't require a token; everything else does — pass one via the
    constructor or :meth:`with_token`.
    """

    def __init__(
        self,
        token: Optional[str] = None,
        base_url: str = "https://neuratalk.in",
        max_retries: int = 3,
        retry_base_delay: float = 0.3,
        session: Optional[requests.Session] = None,
    ):
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay
        self._session = session or requests.Session()

    def with_token(self, token: str) -> "NeuraTalkClient":
        """Returns a new client bound to the given session token, leaving this one unmodified."""
        return NeuraTalkClient(
            token=token,
            base_url=self.base_url,
            max_retries=self.max_retries,
            retry_base_delay=self.retry_base_delay,
            session=self._session,
        )

    # ---- Auth ----

    def register(self, username: str, password: str, **extra: Any) -> Dict[str, Any]:
        return self._request("POST", "/api/auth/register", json={"username": username, "password": password, **extra}, auth=False)

    def login(self, username: str, password: str) -> Dict[str, Any]:
        return self._request("POST", "/api/auth/login", json={"username": username, "password": password}, auth=False)

    def request_otp(self, identifier: str, channel: str) -> Dict[str, Any]:
        return self._request("POST", "/api/auth/otp/request", json={"identifier": identifier, "channel": channel}, auth=False)

    def verify_otp(self, identifier: str, channel: str, code: str, firebase_token: Optional[str] = None) -> Dict[str, Any]:
        body = {"identifier": identifier, "channel": channel, "code": code}
        if firebase_token:
            body["firebaseToken"] = firebase_token
        return self._request("POST", "/api/auth/otp/verify", json=body, auth=False)

    def me(self) -> Dict[str, Any]:
        return self._request("GET", "/api/auth/me")

    def logout(self) -> None:
        self._request("POST", "/api/auth/logout")

    # ---- Calls ----

    def create_call(
        self,
        callee_identifier: str,
        call_type: str,
        my_language: str = "auto",
        their_language: str = "auto",
        **extra: Any,
    ) -> Dict[str, Any]:
        body = {
            "calleeIdentifier": callee_identifier,
            "callType": call_type,
            "myLanguage": my_language,
            "theirLanguage": their_language,
            **extra,
        }
        return self._request("POST", "/api/calls/create", json=body)

    def create_conference_call(self, participant_ids: List[str], host_language: str = "auto", title: Optional[str] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"participantIds": participant_ids, "hostLanguage": host_language}
        if title:
            body["title"] = title
        return self._request("POST", "/api/calls/conference", json=body)

    def connect_call(self, call_id: str, receiver_number: Optional[str] = None) -> Dict[str, Any]:
        return self._request("POST", f"/api/calls/{call_id}/connect", json={"receiverNumber": receiver_number})

    def end_call(self, call_id: str) -> Dict[str, Any]:
        return self._request("POST", f"/api/calls/{call_id}/end")

    def hold_call(self, call_id: str) -> Dict[str, Any]:
        return self._request("POST", f"/api/calls/{call_id}/hold")

    def resume_call(self, call_id: str) -> Dict[str, Any]:
        return self._request("DELETE", f"/api/calls/{call_id}/hold")

    def reject_call(self, call_id: str) -> Dict[str, Any]:
        return self._request("POST", f"/api/calls/{call_id}/reject")

    def get_incoming_call(self) -> Optional[Dict[str, Any]]:
        return self._request("GET", "/api/calls/incoming").get("incoming")

    def list_call_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self._request("GET", "/api/calls/history", params={"limit": limit}).get("calls", [])

    def get_call(self, call_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/api/calls/{call_id}")

    # ---- Transcripts ----

    def search_transcripts(self, query: str, limit: Optional[int] = None, offset: Optional[int] = None) -> Dict[str, Any]:
        params: Dict[str, Any] = {"q": query}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return self._request("GET", "/api/transcripts/search", params=params)

    def get_transcript(self, call_id: str) -> List[Dict[str, Any]]:
        return self._request("GET", f"/api/transcripts/{call_id}").get("segments", [])

    def delete_transcript(self, call_id: str) -> Dict[str, Any]:
        return self._request("DELETE", f"/api/transcripts/{call_id}")

    def export_transcript(self, call_id: str, export_format: str) -> bytes:
        """Returns the raw exported file bytes — write them to disk or stream them as-is."""
        res = self._raw_request("GET", f"/api/transcripts/{call_id}/export/{export_format}")
        return res.content

    # ---- Internals ----

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        auth = kwargs.pop("auth", True)
        res = self._raw_request(method, path, auth=auth, **kwargs)
        if res.status_code == 204 or not res.content:
            return {}
        return res.json()

    def _raw_request(self, method: str, path: str, auth: bool = True, **kwargs: Any) -> requests.Response:
        url = f"{self.base_url}{path}"
        headers = kwargs.pop("headers", {}) or {}
        if auth and self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        attempt = 0
        while True:
            attempt += 1
            try:
                res = self._session.request(method, url, headers=headers, timeout=30, **kwargs)
            except requests.RequestException as cause:
                if attempt > self.max_retries:
                    raise NeuraTalkNetworkError(cause) from cause
                self._backoff(attempt)
                continue

            if not res.ok:
                if res.status_code in _RETRYABLE_STATUS and attempt <= self.max_retries:
                    self._backoff(attempt, res.headers.get("Retry-After"))
                    continue
                try:
                    error_body = res.json()
                except ValueError:
                    error_body = None
                raise NeuraTalkApiError(res.status_code, error_body)
            return res

    def _backoff(self, attempt: int, retry_after_header: Optional[str] = None) -> None:
        delay: float
        if retry_after_header is not None:
            try:
                delay = float(retry_after_header)
            except ValueError:
                delay = self.retry_base_delay * (2 ** (attempt - 1))
        else:
            delay = self.retry_base_delay * (2 ** (attempt - 1))
        time.sleep(delay)

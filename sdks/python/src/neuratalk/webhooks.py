from __future__ import annotations

import hashlib
import hmac
from typing import Union


def verify_webhook_signature(raw_body: Union[str, bytes], signature: str, secret: str) -> bool:
    """Verifies a NeuraTalk-style webhook signature: HMAC-SHA256 over the raw
    request body, hex-encoded, compared in constant time. Mirrors the signing
    scheme NeuraTalk's own backend uses for its Razorpay and MSG91 webhook
    receivers (server/payment-service.ts, server/modules/calls/controller.ts).
    There is no dedicated public "register a webhook" API yet — this helper
    is what you use inside your own webhook endpoint to verify payloads
    NeuraTalk sends you.

    :param raw_body: The exact, unparsed request body — signing breaks if you
        verify against a re-serialized/re-encoded copy of the parsed body.
    :param signature: The signature header value. A leading "sha256=" prefix
        (as MSG91's webhook sends) is stripped automatically.
    :param secret: Your webhook signing secret.
    """
    if isinstance(raw_body, str):
        raw_body = raw_body.encode("utf-8")

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    provided = signature[len("sha256="):] if signature.startswith("sha256=") else signature

    return hmac.compare_digest(expected, provided)

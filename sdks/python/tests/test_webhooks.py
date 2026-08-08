import hashlib
import hmac

from neuratalk import verify_webhook_signature


def test_valid_signature_verifies():
    secret = "topsecret"
    body = b'{"event":"call.completed"}'
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert verify_webhook_signature(body, sig, secret) is True


def test_valid_signature_with_sha256_prefix_verifies():
    secret = "topsecret"
    body = b'{"event":"call.completed"}'
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert verify_webhook_signature(body, f"sha256={sig}", secret) is True


def test_invalid_signature_rejected():
    assert verify_webhook_signature(b"body", "deadbeef" * 8, "secret") is False


def test_tampered_body_rejected():
    secret = "topsecret"
    sig = hmac.new(secret.encode(), b"original", hashlib.sha256).hexdigest()
    assert verify_webhook_signature(b"tampered", sig, secret) is False


def test_string_body_accepted():
    secret = "topsecret"
    body = '{"event":"call.completed"}'
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    assert verify_webhook_signature(body, sig, secret) is True

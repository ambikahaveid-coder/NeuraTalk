# neuratalk

Official Python SDK for the NeuraTalk API.

## Install

```bash
pip install neuratalk
```

## Authenticate

```python
from neuratalk import NeuraTalkClient

client = NeuraTalkClient()  # unauthenticated, for login/OTP endpoints

# Password login
result = client.login("myusername", "mypassword")

# Or OTP login (auto-registers new users)
client.request_otp("+919876543210", "mobile")
result = client.verify_otp("+919876543210", "mobile", "123456")

authed = client.with_token(result["token"])
```

## Make a call

```python
session = authed.create_call(
    callee_identifier="+919876543210",
    call_type="voice",
    my_language="en",
    their_language="es",
)
# session["livekitUrl"] / session["livekitToken"] — hand these to a LiveKit client SDK
```

## Search and export transcripts

```python
page = authed.search_transcripts("invoice", limit=20)
for segment in page["results"]:
    print(segment["originalText"], "->", segment["translatedText"])

pdf_bytes = authed.export_transcript(session["callId"], "pdf")
with open("transcript.pdf", "wb") as f:
    f.write(pdf_bytes)
```

## Verify a webhook

```python
from neuratalk import verify_webhook_signature
from flask import Flask, request

app = Flask(__name__)

@app.post("/webhooks/neuratalk")
def handle_webhook():
    signature = request.headers.get("X-NeuraTalk-Signature", "")
    if not verify_webhook_signature(request.get_data(), signature, WEBHOOK_SECRET):
        return "", 401
    # ... handle event
    return "", 200
```

## Error handling

Every non-2xx response raises `NeuraTalkApiError` with `.status` and `.body` (the parsed JSON error payload — shape varies by module). Network failures raise `NeuraTalkNetworkError`.

```python
from neuratalk import NeuraTalkApiError

try:
    authed.create_call(callee_identifier="+91...", call_type="voice")
except NeuraTalkApiError as e:
    if e.status == 402:
        print("Insufficient balance")
    raise
```

## Retries

Network errors and `429`/`500`/`502`/`503`/`504` responses are retried automatically with exponential backoff (respecting a `Retry-After` header when present). Configure via `max_retries`/`retry_base_delay` in the constructor. Disable with `max_retries=0`.

## Versioning

There is currently no URL-based API versioning on the NeuraTalk server (all routes are flat `/api/...`) — this SDK is versioned at the package level instead.

## Development

```bash
pip install -e ".[dev]"
pytest tests/
```

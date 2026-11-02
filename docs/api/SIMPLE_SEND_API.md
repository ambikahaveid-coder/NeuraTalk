# NeuraTalk one-line Send API

For billing software, gateways and scripts that can only call a URL. Messages arrive inside the customer's NeuraTalk app.

## Before you start

1. Create an API key with the **messages:send** permission (company dashboard → API keys). Treat it like a password.
2. Get a template approved (dashboard → Business Messaging → Templates). Only approved templates can be sent at any time.

## Send a template

```
GET https://neuratalk.in/api/v1/send?apikey=YOUR_KEY&phone=9876543210&text=order_ready&Params=A-1001,Rs 450
```

- `text` is the template **name**.
- `Params` fills the template's variables **in order**, comma separated. `{{name}}` is filled automatically from the customer's name, so leave it out of `Params`.
- A JSON array also works: `Params=["A-1001","Rs 450"]` (use it when a value has a comma).

## Send free text

Only within 24 hours of the customer's last message to you (for replies and bots):

```
GET https://neuratalk.in/api/v1/send?apikey=YOUR_KEY&phone=9876543210&message=Your order is ready
```

## Send a verification code

```
GET https://neuratalk.in/api/v1/send?apikey=YOUR_KEY&phone=9876543210&stype=auth
```

NeuraTalk creates the code. The reply has a `challengeId`. Check what the person typed with `POST /api/v1/messaging/otp/{challengeId}/verify` and `{"code":"123456"}`.

## Replies

Success (`201`):

```json
{"success":true,"status":"sent","type":"template","messageId":27,"chargedPaise":10,"notes":[]}
```

Failure:

```json
{"success":false,"status":"failed","code":"TEMPLATE_NOT_FOUND","error":"No approved template named \"order_redy\"."}
```

| code | Meaning |
|---|---|
| PHONE_REQUIRED / BAD_PHONE | Phone missing or not a valid number |
| TEMPLATE_NOT_FOUND | No approved template with that name |
| SERVICE_WINDOW_CLOSED | Free text outside 24 h: send a template |
| NO_CREDIT | Wallet is empty: recharge first |
| 401 | API key missing, wrong or revoked |

## Coming from another panel

| Other panel | NeuraTalk |
|---|---|
| `user` + `pass` in the URL | `apikey` only. Your password is never used. |
| `text=TEMPLATENAME` | Same |
| `Params=a,b` | Same |
| `stype=normal` / `stype=auth` | Same |
| `htype=image&url=…` | Not used. The image is part of the approved template. |
| `sender`, `priority` | Ignored |

**Safer option:** send the key in an `X-API-Key` header and use `POST` with a JSON body (`phone`, `text`, `Params`, `message`). A key in a URL can end up in browser history and proxy logs.

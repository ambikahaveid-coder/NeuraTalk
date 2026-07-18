# Jago Contact Call API

Purpose:
- driver <-> user contact calling
- app-to-app first
- PSTN fallback when needed
- Neura Talk API key protected

Base headers:

```http
X-API-Key: ntk_ent_your_key_here
Content-Type: application/json
```

## Create Contact Call

`POST /api/integrations/jago/contact-call`

```json
{
  "rideId": "ride_12345",
  "initiator": "driver",
  "driver": {
    "externalId": "driver_991",
    "phoneNumber": "+919876543210",
    "displayName": "Driver Ravi",
    "language": "te"
  },
  "user": {
    "externalId": "user_441",
    "phoneNumber": "+919812345678",
    "displayName": "Customer Asha",
    "language": "hi"
  },
  "callType": "voice",
  "transportPreference": "auto",
  "enableRecording": false
}
```

Response highlights:
- `route`
- `sessionId`
- `callId`
- `livekitUrl`
- `livekitToken`
- `pstnCallId`
- `session`

Notes:
- `callType=video` is useful only for app-to-app.
- `transportPreference=auto` is safest default.
- PSTN/mobile paths are voice-only.

## Get Contact Call Status

`GET /api/integrations/jago/contact-call/:sessionId`

Use this to check:
- session state
- provider
- route type
- PSTN call id
- lifecycle progress

## End Contact Call

`POST /api/integrations/jago/contact-call/:sessionId/end`

```json
{
  "reason": "ride_completed"
}
```

## Activate PSTN Fallback

`POST /api/integrations/jago/contact-call/:sessionId/fallback`

Use only if the app-to-app path cannot continue and your API key allows PSTN fallback.

## Recommended Jago Flow

1. Jago backend calls `POST /api/integrations/jago/contact-call`
2. If both users are app-capable, use `livekitUrl` + `livekitToken`
3. Poll `GET /api/integrations/jago/contact-call/:sessionId`
4. If app path fails and policy allows, trigger PSTN fallback
5. On ride end or cancel, call `.../end`

## Honest Limits

- app-to-app is the strongest path
- PSTN is a fallback path, not the primary premium experience
- caller ID on PSTN depends on provider/compliance
- telecom-grade field proof is still separate from API readiness

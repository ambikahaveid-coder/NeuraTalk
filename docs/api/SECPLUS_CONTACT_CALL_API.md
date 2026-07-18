# SecPlus Contact Call API

Purpose:
- agent <-> customer contact calling
- app-to-app first
- PSTN fallback when needed
- automatic language handling defaults
- recording requested on every call by default

Headers:

```http
X-API-Key: ntk_ent_your_key_here
Content-Type: application/json
```

## Create Contact Call

`POST /api/integrations/secplus/contact-call`

```json
{
  "caseId": "case_20260529_441",
  "initiator": "agent",
  "agent": {
    "externalId": "agent_991",
    "phoneNumber": "+919876543210",
    "displayName": "Agent Ravi",
    "language": "auto"
  },
  "customer": {
    "externalId": "customer_441",
    "phoneNumber": "+919812345678",
    "displayName": "Customer Asha",
    "language": "auto"
  },
  "callType": "voice",
  "transportPreference": "auto",
  "enableRecording": true
}
```

Behavior:
- language defaults to `auto`
- Neura Talk app-to-app path is preferred
- PSTN fallback can be activated if policy allows
- call recording is requested by default

Response highlights:
- `route`
- `sessionId`
- `livekitUrl`
- `livekitToken`
- `masking`
- `recordingRequested`
- `recordingEnabled`
- `autoLanguageDetect`
- `session`

## Get Call Status

`GET /api/integrations/secplus/contact-call/:sessionId`

Use this for:
- session state
- route type
- provider
- PSTN call id
- lifecycle status

## End Call

`POST /api/integrations/secplus/contact-call/:sessionId/end`

```json
{
  "reason": "case_closed"
}
```

## Activate PSTN Fallback

`POST /api/integrations/secplus/contact-call/:sessionId/fallback`

Use when app-to-app path cannot continue and your key allows PSTN fallback.

## Safety Contact Call

Use this when protected-participant safety requires voice-only calling with automatic recording policy.

`POST /api/integrations/secplus/safety-contact-call`

```json
{
  "caseId": "case_20260529_991",
  "initiator": "agent",
  "agent": {
    "externalId": "agent_100",
    "phoneNumber": "+919800000001",
    "displayName": "Agent Kavya",
    "language": "auto",
    "gender": "female"
  },
  "customer": {
    "externalId": "customer_200",
    "phoneNumber": "+919800000002",
    "displayName": "Customer Rani",
    "language": "auto",
    "gender": "female"
  },
  "transportPreference": "auto",
  "protectedParticipantRole": "auto",
  "forceSafetyRecording": false
}
```

Behavior:
- voice-only
- auto language detect on both sides
- if protected participant resolves to a female participant, recording is requested automatically
- response includes:
  - `recordingRequested`
  - `recordingEnabled`
  - `protectedParticipantRole`
  - `consentAnnouncementRequired`

Important:
- final recording availability still depends on org policy/runtime support
- legal consent / announcement policy must be handled by the integrating business
- PSTN/mobile remains voice-only

## Honest Limits

- `auto` language improves flexibility, but final field quality still depends on audio/network quality
- PSTN/mobile remains voice-only
- recording is requested by default, but final availability still depends on org pricing/policy/runtime support
- telecom-grade proof is separate from API readiness

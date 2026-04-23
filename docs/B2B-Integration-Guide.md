# NeuraTalk B2B Integration Guide

## Call Center Phone System Integration

This guide explains how call centers can connect their existing phone infrastructure (PBX, SIP trunks) to NeuraTalk for real-time translation services.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CALL CENTER INFRASTRUCTURE                       │
│                                                                          │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐          │
│   │   Agents     │◄──►│     PBX      │◄──►│   SIP Trunk      │          │
│   │  (Softphone) │    │(Asterisk/etc)│    │  Provider        │          │
│   └──────────────┘    └──────────────┘    └──────────────────┘          │
│                              │                                           │
│                              │ SIP/RTP                                   │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         NEURATALK PLATFORM                                │
│                                                                           │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐           │
│   │   SIP Edge   │◄──►│  Media Relay │◄──►│  AI Translation  │           │
│   │   Gateway    │    │  (RTP Proxy) │    │     Pipeline     │           │
│   └──────────────┘    └──────────────┘    └──────────────────┘           │
│          │                   │                      │                     │
│          │                   │                      │                     │
│          ▼                   ▼                      ▼                     │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐           │
│   │   Signaling  │◄──►│   WebSocket  │◄──►│   Agent Portal   │           │
│   │    Server    │    │   Control    │    │   (Subtitles)    │           │
│   └──────────────┘    └──────────────┘    └──────────────────┘           │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Integration Options

### Option 1: SIP Trunk Integration (Recommended for Enterprise)

**Best for:** Large call centers with existing PBX infrastructure

#### How It Works:
1. Configure your PBX to route calls through NeuraTalk's SIP Edge Gateway
2. Audio streams through our translation pipeline
3. Translated audio returns to your agents
4. Real-time subtitles displayed in agent portal

#### SIP Configuration:
```
# Add NeuraTalk as SIP trunk in your PBX
SIP Trunk Settings:
  - Host: sip.neuratalk.yourcompany.com
  - Port: 5060 (SIP) / 5061 (SIPS/TLS)
  - Transport: TLS (recommended) / UDP
  - Codec: G.711 (PCMU/PCMA) or Opus
  - Authentication: Username + Password (provided by NeuraTalk admin)
```

#### Dial Plan Example (Asterisk):
```ini
; Route international calls through NeuraTalk for translation
[neuratalk-translation]
exten => _X.,1,NoOp(Routing to NeuraTalk for translation)
exten => _X.,n,Set(CALLERID(name)=${CALLERID(name)})
exten => _X.,n,Dial(SIP/neuratalk-trunk/${EXTEN})
exten => _X.,n,Hangup()
```

---

### Option 2: WebRTC Gateway Integration

**Best for:** Modern call centers using browser-based softphones

#### How It Works:
1. Agents connect via WebRTC through NeuraTalk portal
2. Calls routed to/from your SIP infrastructure
3. Translation happens in real-time
4. Subtitles shown directly in browser

#### Integration Code:
```javascript
// Connect agent to NeuraTalk WebRTC gateway
const signalingSocket = new WebSocket('wss://yourapp.replit.app/ws/signaling');

signalingSocket.onopen = () => {
  // Register as enterprise agent
  signalingSocket.send(JSON.stringify({
    type: 'register',
    userId: agentId,
    userType: 'agent',
    tenantId: 'your-company-id',
    capabilities: ['translation', 'emotion-detection']
  }));
};

// Handle incoming calls
signalingSocket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'incoming-call') {
    // Show call notification to agent
    showIncomingCall(message.callerId, message.callerName);
  }
  
  if (message.type === 'translation-subtitle') {
    // Display real-time translation
    displaySubtitle(message.text, message.language, message.emotion);
  }
};
```

---

### Option 3: REST API Integration

**Best for:** Custom integrations, CRM systems, analytics

#### API Endpoints:

##### Tenant Management
```
POST   /api/enterprise/tenants              - Create new tenant
GET    /api/enterprise/tenants/:id          - Get tenant details
PATCH  /api/enterprise/tenants/:id          - Update tenant settings
DELETE /api/enterprise/tenants/:id          - Remove tenant
```

##### Call Control
```
POST   /api/enterprise/calls/initiate       - Start outbound call with translation
POST   /api/enterprise/calls/:id/transfer   - Transfer call
POST   /api/enterprise/calls/:id/hold       - Hold call
POST   /api/enterprise/calls/:id/resume     - Resume call
POST   /api/enterprise/calls/:id/end        - End call
GET    /api/enterprise/calls/:id/status     - Get call status
```

##### Translation Settings
```
POST   /api/enterprise/calls/:id/translation/enable   - Enable translation
POST   /api/enterprise/calls/:id/translation/disable  - Disable translation
PATCH  /api/enterprise/calls/:id/translation/config   - Update language pair
```

##### Analytics & Billing
```
GET    /api/enterprise/usage                - Get usage statistics
GET    /api/enterprise/usage/calls          - Call history
GET    /api/enterprise/billing/invoices     - Invoice list
```

#### Example: Initiate Translated Call
```javascript
const response = await fetch('/api/enterprise/calls/initiate', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tenantId: 'your-company-id',
    agentId: 'agent-123',
    destination: '+91-9876543210',
    sourceLanguage: 'en',
    targetLanguage: 'te',
    enableEmotionDetection: true,
    recordingConsent: true
  })
});

const { callId, status } = await response.json();
```

---

## Authentication & Security

### API Token Authentication
```javascript
// Request headers
{
  "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "X-Tenant-ID": "your-company-id"
}
```

### SIP Authentication
```
Username: your-tenant-username
Password: [secure password from admin portal]
Realm: neuratalk.yourcompany.com
```

### Security Features
- **mTLS**: Mutual TLS between PBX and SIP Edge
- **SRTP**: Encrypted media streams
- **JWT Tokens**: Secure API authentication
- **Tenant Isolation**: Complete data separation
- **Audit Logs**: All call state changes logged

---

## WebSocket Call Control

### Connection
```javascript
const ws = new WebSocket('wss://yourapp.replit.app/ws/enterprise-control');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'authenticate',
    apiKey: 'your-api-key',
    tenantId: 'your-company-id'
  }));
};
```

### Message Types

#### Outbound Messages (Client → Server)
```javascript
// Start call
{ type: 'call:start', destination: '+91...', agentId: '...', languages: ['en', 'te'] }

// End call
{ type: 'call:end', callId: '...' }

// Toggle translation
{ type: 'call:translation:toggle', callId: '...', enabled: true }

// Change language pair
{ type: 'call:translation:config', callId: '...', source: 'en', target: 'hi' }
```

#### Inbound Messages (Server → Client)
```javascript
// Call state updates
{ type: 'call:ringing', callId: '...', destination: '...' }
{ type: 'call:connected', callId: '...', duration: 0 }
{ type: 'call:ended', callId: '...', reason: 'normal', duration: 180 }

// Real-time translation
{ type: 'translation:subtitle', callId: '...', text: '...', language: 'te', emotion: 'happy' }

// Emotion updates
{ type: 'emotion:update', callId: '...', emotion: 'stressed', confidence: 0.87 }
```

---

## Agent Portal Integration

### Embedding Translation Subtitles

```html
<!-- Add to your agent portal -->
<div id="neuratalk-subtitles"></div>

<script>
  const subtitleContainer = document.getElementById('neuratalk-subtitles');
  
  // Connect to subtitle stream
  const eventSource = new EventSource(`/api/enterprise/calls/${callId}/subtitles`);
  
  eventSource.onmessage = (event) => {
    const { text, language, emotion, speaker } = JSON.parse(event.data);
    
    const subtitle = document.createElement('div');
    subtitle.className = `subtitle ${speaker} ${emotion}`;
    subtitle.textContent = text;
    
    subtitleContainer.appendChild(subtitle);
    subtitleContainer.scrollTop = subtitleContainer.scrollHeight;
  };
</script>
```

### CRM Integration Example (Salesforce)
```javascript
// Push translation to Salesforce case notes
async function syncToSalesforce(callId, translations) {
  await salesforce.Case.update(caseId, {
    Call_Translation_Notes__c: translations.map(t => 
      `[${t.timestamp}] ${t.speaker}: ${t.originalText} → ${t.translatedText}`
    ).join('\n')
  });
}
```

---

## Supported Languages

| Language | Code | STT | TTS | Emotion |
|----------|------|-----|-----|---------|
| English | en | Yes | Yes | Yes |
| Telugu | te | Yes | Yes | Yes |
| Hindi | hi | Yes | Yes | Yes |
| Tamil | ta | Yes | Yes | Yes |
| Kannada | kn | Yes | Yes | Yes |
| Malayalam | ml | Yes | Yes | Yes |
| Bengali | bn | Yes | Yes | Yes |
| Marathi | mr | Yes | Yes | Yes |
| Gujarati | gu | Yes | Yes | Yes |
| Punjabi | pa | Yes | Yes | Yes |
| Spanish | es | Yes | Yes | Yes |
| French | fr | Yes | Yes | Yes |
| German | de | Yes | Yes | Yes |
| Japanese | ja | Yes | Yes | Yes |
| Chinese | zh | Yes | Yes | Yes |
| Arabic | ar | Yes | Yes | Yes |

**Mixed Language Support**: Tenglish (Telugu + English), Hinglish (Hindi + English) auto-detected

---

## Pricing & Usage

### B2B Billing Models

1. **Prepaid Credits**
   - Purchase credits upfront
   - Deducted per minute of translated calls
   - Best for predictable volume

2. **Postpaid (Enterprise)**
   - Monthly invoicing based on usage
   - Volume discounts available
   - Minimum commitment required

### Usage Tracking
```javascript
// Get current month usage
const usage = await fetch('/api/enterprise/usage?period=current-month', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Response
{
  "totalMinutes": 12450,
  "translatedMinutes": 10280,
  "languages": {
    "en-te": 5200,
    "en-hi": 3800,
    "en-ta": 1280
  },
  "emotionDetectionMinutes": 8500,
  "estimatedCost": "₹52,400"
}
```

---

## Compliance & Privacy

### Data Handling
- **No Call Recording**: Unless explicit consent given
- **No PII Storage**: Call content not stored by default
- **Audit Logs**: Only call metadata (state changes, not content)
- **GDPR Compliant**: Data minimization, right to deletion

### Consent Management
```javascript
// Before enabling translation, verify consent
const consentStatus = await fetch(`/api/enterprise/calls/${callId}/consent`);

if (!consentStatus.translationConsent) {
  // Play consent prompt to caller
  await playConsentPrompt(callId);
  
  // Wait for consent confirmation
  const consent = await waitForConsent(callId, 30000); // 30s timeout
  
  if (!consent) {
    // Proceed without translation
    disableTranslation(callId);
  }
}
```

---

## Self-Hosted Deployment

Per our **Dependency Zero Policy**, NeuraTalk can be deployed entirely on your infrastructure:

### Components Required
| Component | Technology | Purpose |
|-----------|------------|---------|
| SIP Edge | Kamailio/OpenSIPS | SIP routing |
| Media Relay | RTPengine | Audio processing |
| STT | Whisper (self-hosted) | Speech-to-text |
| TTS | Coqui/VITS | Text-to-speech |
| NMT | MarianMT/NLLB | Translation |
| Backend | Node.js | API & WebSocket |
| Database | PostgreSQL | Data storage |

### Docker Compose Example
```yaml
version: '3.8'
services:
  sip-edge:
    image: kamailio/kamailio:5.7
    ports:
      - "5060:5060/udp"
      - "5061:5061/tcp"
    volumes:
      - ./kamailio.cfg:/etc/kamailio/kamailio.cfg

  media-relay:
    image: drachtio/rtpengine
    network_mode: host
    environment:
      - RTPENGINE_OPTS=--interface=eth0

  neuratalk-api:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgres://...
      - SIP_EDGE_HOST=sip-edge
      - MEDIA_RELAY_HOST=media-relay
```

---

## Support & Contact

- **Technical Support**: support@neuratalk.ai
- **Enterprise Sales**: enterprise@neuratalk.ai
- **Documentation**: docs.neuratalk.ai
- **API Status**: status.neuratalk.ai

---

## Quick Start Checklist

- [ ] Create enterprise tenant account
- [ ] Configure SIP trunk or WebRTC integration
- [ ] Set up authentication tokens
- [ ] Configure language pairs
- [ ] Integrate subtitles into agent portal
- [ ] Set up usage alerts and billing
- [ ] Train agents on new workflow
- [ ] Go live with pilot group
- [ ] Scale to full deployment

---

*Last Updated: January 2026*
*NeuraTalk Platform Version: 2.0*

# NeuraTalk Demo Walkthrough

## Demo Overview

This document provides a step-by-step guide for demonstrating NeuraTalk's capabilities as a working, production-ready system.

---

## Demo URL

**Development**: http://localhost:5000
**Production**: https://neuratalk.in

---

## Demo Flow (Recommended Order)

### Part 1: Landing & Marketing Pages (2 min)

1. **Homepage** (/)
   - Show the hero section with NeuraTalk branding
   - Highlight "50+ Languages" and "Ultra-Low Latency" features
   - Point out the call-to-action buttons

2. **Products Page** (/products)
   - Walk through Voice Calls, Video Meetings, AI Assistant features
   - Show the feature comparison grid

3. **Pricing Page** (/pricing)
   - Display Individual Plans (Free, Pro, Unlimited)
   - Show Business Plans (Starter, Enterprise)
   - Highlight the transparent pricing model

4. **Legal Pages**
   - Quick look at /privacy, /terms, /dpa
   - Note GDPR and DPDP Act compliance
   - Mention company registration: Mindwhile It Solutions Pvt Ltd

---

### Part 2: Authentication Flow (2 min)

1. **Login** (/login)
   - Select "Personal" account type
   - Enter phone number (e.g., +91 98765 43210)
   - Click "Continue" to request OTP
   
2. **OTP Verification**
   - Show the 6-digit OTP input screen
   - In test mode, use code: 123456
   - Click "Verify" to complete authentication

3. **Dashboard Redirect**
   - Show automatic redirect to consumer dashboard
   - Point out session is now active

---

### Part 3: Consumer Dashboard (3 min)

1. **Dashboard Overview** (/dashboard)
   - Show user statistics (calls, minutes used)
   - Display quick action cards
   - Highlight the sidebar navigation

2. **Billing Page** (/billing)
   - Show available subscription plans
   - Display current subscription status
   - Note: Payment integration with Razorpay (live key configured)

3. **Call History** (/call-history)
   - Show empty state for new users
   - Explain call logging and translation history

---

### Part 4: Core Feature - Video Translation Call (5 min)

1. **Navigate to Video Translation** (/calls/video-translation)

2. **Setup Call Parameters**
   - Select "My Language" (e.g., Telugu)
   - Select "Their Language" (e.g., English)
   - Toggle translation features:
     - Real-time Translation: ON
     - Emotion Detection: ON
     - Live Subtitles: ON

3. **Start a Call**
   - Click "Start Video Call"
   - Grant camera/microphone permissions
   - Show the local video preview

4. **Demonstrate Features**
   - Show language selection dropdowns
   - Explain the signaling connection status
   - Point out the call controls (mute, end call)

5. **End Call**
   - Click "End Call"
   - Return to idle state

---

### Part 5: API Documentation (2 min)

1. **Swagger UI** (/api/docs)
   - Show interactive API documentation
   - Highlight key endpoints:
     - Authentication APIs
     - Translation APIs
     - Billing APIs
     - WebRTC APIs

2. **API Categories**
   - Auth: OTP-based login
   - Translation: STT, Translation, TTS
   - Billing: Plans, Subscriptions, Invoices
   - WebRTC: Signaling, ICE servers

---

### Part 6: Enterprise Features (Optional, 3 min)

1. **Role-Based Access**
   - Explain 5-tier role system
   - Super Admin, Investor, Company Admin, Agent, Consumer

2. **B2B Features**
   - Organization management
   - Team member management
   - Usage analytics

3. **Compliance**
   - GDPR rights (data export, deletion)
   - Audit logging
   - Session management

---

## Key Talking Points

### Technology Highlights
- "Dependency Zero Policy" - Self-hosted, no external SaaS dependencies
- Real-time WebRTC with signaling server
- 20+ supported languages including Indian languages
- Emotion-aware translation

### Business Value
- B2B and B2C subscription models
- GST-compliant invoicing for India
- Multi-tenant architecture
- Enterprise security features

### What Makes It Real (Not Demo)
- Database-backed sessions
- Actual OTP flow (test mode for demo)
- Real WebRTC signaling
- Working Razorpay integration (live key configured)
- Production-grade error handling

---

## Video Recording Script

### Introduction (30 sec)
"Welcome to NeuraTalk - a production-grade, multilingual voice and video communication platform. Today I'll show you how it works end-to-end."

### Marketing Pages (1 min)
"Starting with our public pages - you can see our products, pricing, and legal compliance pages. Notice we support 50+ languages and enterprise features."

### Login Flow (1 min)
"Let me log in. I'll enter my phone number, receive an OTP, and authenticate. This uses a secure session-based authentication system."

### Dashboard (2 min)
"Once logged in, I'm on my dashboard. I can see my usage, access billing, and start calls. The system tracks everything in a PostgreSQL database."

### Video Translation Demo (3 min)
"The core feature - video translation calls. I'll select my language, the other person's language, and start a call. The system provides real-time translation with emotion detection."

### API Documentation (1 min)
"For developers, we have complete API documentation. All endpoints are documented with OpenAPI specs and can be tested directly from Swagger UI."

### Closing (30 sec)
"That's NeuraTalk - a complete, working platform for multilingual voice and video communication. Built for enterprise, ready for production."

---

## Troubleshooting During Demo

### If OTP doesn't work
- In test mode, the code is always: 123456
- Check if Firebase is configured for real SMS

### If video doesn't load
- Ensure camera/microphone permissions granted
- Check browser compatibility (Chrome/Firefox recommended)

### If calls don't connect
- TURN server may not be configured
- Works best on same network without TURN

### If pricing doesn't load
- Check if billing plans are seeded
- API should return default plans as fallback

---

## Post-Demo Resources

- API Documentation: /api/docs
- OpenAPI Spec: /api/openapi.json
- Privacy Policy: /privacy
- Terms of Service: /terms
- Contact: /contact

---

**Company**: Mindwhile It Solutions Pvt Ltd
**Location**: 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, AP 522503

# 🧪 DETAILED TEST EXECUTION GUIDE
**Step-by-Step Testing for B2B, B2C, C2C Systems**

**Status**: System Running at localhost:5000  
**Created**: April 2, 2026

---

## ✅ QUICK START

### Access Points
```
Backend Server: http://localhost:5000
API Health: http://localhost:5000/health
API Documentation: http://localhost:5000/api/docs
WebSocket: ws://localhost:5000/ws/signaling
```

---

## 🔴 CRITICAL TESTS - Run First

### Test 1: API Health Check
```bash
curl http://localhost:5000/health
# Expected: 200 OK with { status: "healthy" }
```

**Result**: [ ] PASS [ ] FAIL  
**Notes**: _______________

---

### Test 2: Database Connection
```bash
curl -X POST http://localhost:5000/api/test/db \
  -H "Content-Type: application/json"
# Expected: 200 OK with connection status
```

**Result**: [ ] PASS [ ] FAIL  
**Notes**: _______________

---

### Test 3: Authentication System
```javascript
// Test endpoint: POST /api/auth/signup
{
  "email": "test@example.com",
  "password": "Test123!@#",
  "role": "consumer"
}
// Expected: 201 Created with userId, token
```

**Result**: [ ] PASS [ ] FAIL  
**Error**: _______________

---

## 🟢 B2B SYSTEM TEST SCENARIOS

### B2B Scenario 1: Company Registration

**Objective**: Create a B2B company account

**Test Steps**:
```
1. Navigate to: http://localhost:5000/register/company
2. Fill form:
   - Company Name: "Acme Corp"
   - Admin Email: "admin@acmecorp.com"
   - Admin Phone: "+91 98765 43210"
   - Industry: "Healthcare"
3. Click "Register Company"
4. Verify: Email sent, confirmation token in response
5. Confirm email from link sent
6. Verify: Company created in database
```

**Expected Result**: ✅
- Company registered
- Admin user created
- Welcome email sent
- Dashboard accessible

**Actual Result**: 
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Issues Found**: _______________

**Evidence**: 
```
Request:
POST /api/b2b/company/register HTTP/1.1
{
  "company_name": "Acme Corp",
  "admin_email": "admin@acmecorp.com",
  "admin_phone": "+91 98765 43210",
  "industry": "healthcare"
}

Response:
HTTP/1.1 201 Created
{
  "company_id": "comp_xxxxxxx",
  "admin_user_id": "user_xxxxxxx",
  "confirmation_email_sent": true
}
```

---

### B2B Scenario 2: Add Agents to Company

**Objective**: Company admin adds agents

**Test Steps**:
```
1. Login as: admin@acmecorp.com
2. Go to: Dashboard → Agents → Add Agent
3. Fill form:
   - Agent Email: "agent1@acmecorp.com"
   - Agent Phone: "+91 98765 43211"
   - Name: "John Smith"
   - Language: "English, Hindi"
   - Skills: "Technical Support, Sales"
4. Click "Add Agent"
5. Agent receives invite email
6. Agent clicks link, sets password
7. Agent logs in with new account
```

**Expected Result**: ✅
- Agent created
- Agent email sent
- Agent role assigned
- Agent can login

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Issues Found**: _______________

---

### B2B Scenario 3: Agent-to-Agent Call

**Objective**: Two agents make a peer call

**Test Steps**:
```
1. Agent 1 (agent1@acmecorp.com) logged in
2. Agent 2 (agent2@acmecorp.com) logged in
3. Agent 1: Click "Dial" → Search "Agent 2"
4. Agent 1: Click "Call Agent2"
5. Agent 2: See incoming call notification
6. Agent 2: Click "Accept Call"
7. Both: Speak for 2 minutes
8. Agent 1: Click "End Call"
9. Both: Call ends successfully
```

**Expected Result**: ✅
- Call connects within 2 seconds
- Audio quality: HD (clear, no lag)
- Both can hear each other
- No drops during call
- Call recorded
- Call duration tracked

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Issues Found**: _______________

**Call Quality Metrics**:
```
[ ] Audio clarity (1-10): ___
[ ] Lag (0-500ms): ___
[ ] Drops (0): ___
[ ] Recording quality: ___
```

---

### B2B Scenario 4: B2C Inbound Call to B2B

**Objective**: Consumer calls B2B company, agent picks up

**Test Steps** (requires B2C user):
```
1. B2C Consumer makes call to B2B company
2. Company: Number shows incoming call
3. Company: Dashboard shows "Incoming call"
4. Available Agent 1: Gets offer to accept
5. Agent 1: Clicks "Accept"
6. Consumer & Agent: Connected
7. Conversation for 3 minutes
8. Agent: Ends call
9. System: Records call, calculates billing
```

**Expected Result**: ✅
- Call routes to available agent
- Agent can accept call
- Call quality good
- Billing accurate (3 min × rate)
- Both can understand (translation working)

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Issues Found**: _______________

---

### B2B Scenario 5: Billing & Invoice

**Objective**: Monthly invoice generated with correct totals

**Test Steps**:
```
1. Make 5 calls:
   - Call 1: 10 minutes
   - Call 2: 15 minutes
   - Call 3: 5 minutes
   - Call 4: 20 minutes
   - Call 5: 30 minutes
   (Total: 80 minutes)
2. Admin: Go to Billing → Invoices
3. Admin: View current month invoice
4. Verify:
   - Total minutes = 80
   - Rate = ₹5/min (example)
   - Subtotal = ₹400
   - GST 18% = ₹72
   - Total = ₹472
5. Download invoice as PDF
```

**Expected Result**: ✅
- Invoice generated
- Calculations correct
- GST applied correctly
- PDF downloadable

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Invoice Details**:
```
Total Minutes: ___
Rate per Minute: ___
Subtotal: ___
GST (18%): ___
Total Due: ___
```

---

### B2B Scenario 6: Real-Time Dashboard

**Objective**: Admin sees live metrics

**Test Steps**:
```
1. Admin: Open analytics dashboard
2. During agent call: Dashboard updates in real-time
3. View metrics:
   - Active calls (should be 1)
   - Call duration (increasing)
   - Agents online
   - Total today minutes
4. End call
5. Dashboard updates: Call appears in history
```

**Expected Result**: ✅
- Metrics update every 5 seconds
- No lag
- All calculations correct

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Issues Found**: _______________

---

## 🔵 B2C SYSTEM TEST SCENARIOS

### B2C Scenario 1: Consumer Registration & Verification

**Objective**: New consumer creates account and verifies phone

**Test Steps**:
```
1. Navigate to: http://localhost:5000/register/consumer
2. Enter Phone: "+91 99999 99999"
3. Click "Send OTP"
4. ✅ OTP sent via SMS (or shown in test)
5. Enter OTP received
6. Click "Verify"
7. Set Password
8. Set Display Name: "Raj Kumar"
9. Click "Complete Registration"
10. ✅ Account created, logged in
```

**Expected Result**: ✅
- SMS sent with OTP
- OTP verified
- Account created
- Can access dashboard

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Issues Found**: _______________

---

### B2C Scenario 2: Payment & Credit Recharge

**Objective**: Consumer adds credit via Razorpay

**Test Steps**:
```
1. Consumer: Go to Dashboard → Wallet → Recharge
2. Select Amount: ₹500
3. Click "Pay with Razorpay"
4. 🟠 Razorpay modal opens
5. Test Card: 4111111111111111
6. Expiry: 12/25
7. CVV: 123
8. Click "Pay"
9. 🟠 Payment processed
10. ✅ Credit added to wallet
11. Balance shows: ₹500.00
```

**Expected Result**: ✅
- Razorpay modal opens
- Card accepted
- Payment processed
- Credit added
- Balance updated

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Payment Details**:
```
Amount Paid: ₹___
Fee Charged: ₹___
Credit Received: ₹___
Balance: ₹___
```

---

### B2C Scenario 3: Browse Companies & Make Call

**Objective**: Consumer browses companies by language/category

**Test Steps**:
```
1. Consumer: Go to Dashboard → Companies
2. Filter by:
   - Language: "Tamil"
   - Category: "Healthcare"
3. ✅ List shows 5 companies matching
4. Click on "Dr. Health Clinic"
5. View company details:
   - Description
   - Languages: Tamil, English
   - Rate: ₹2.50/min
   - Available agents: 3
6. Click "Call Company"
7. Calling screen appears
8. Call connects to available agent
9. Timer starts
10. Both speaking for 4 minutes
11. Hang up
```

**Expected Result**: ✅
- Companies listed
- Filters work
- Company details show
- Call connects quickly
- Real-time translation works
- Timer accurate
- Call charges correctly (4 min × ₹2.50 = ₹10)

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Call Summary**:
```
Company: ___
Duration: ___ minutes
Rate: ₹___ per minute
Charge: ₹___
Balance Before: ₹___
Balance After: ₹___
```

---

### B2C Scenario 4: Insufficient Balance Blocked

**Objective**: Consumer cannot call when balance too low

**Test Steps**:
```
1. Consumer: Check balance (e.g., ₹5)
2. Attempt to call ₹2.50/min company
3. System calculates: 5 ÷ 2.50 = 2 minutes max
4. Call connects
5. After 3 minutes:
   - Balance reached ₹0
   - System should cut call
   - Message: "Balance insufficient. Call ended."
6. Verify call ends
```

**Expected Result**: ✅
- Call cut after balance exhausted
- Consumer notified
- Agent notified
- Call logged properly

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Issues Found**: _______________

---

### B2C Scenario 5: Call History & Feedback

**Objective**: Consumer views past calls and leaves feedback

**Test Steps**:
```
1. Consumer: Go to Dashboard → Call History
2. ✅ Shows all past calls:
   - Company name
   - Date & time
   - Duration
   - Cost
3. Click on a recent call
4. View call details:
   - Transcript (if available)
   - Recording option
5. Click "Leave Feedback"
6. Rate: 5 stars ⭐⭐⭐⭐⭐
7. Comment: "Very helpful!"
8. Submit feedback
9. ✅ Feedback saved
```

**Expected Result**: ✅
- History shows all calls
- Filters work (date range, company)
- Call details accessible
- Feedback submitted

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Issues Found**: _______________

---

### B2C Scenario 6: Real-Time Translation

**Objective**: Conversation translated in real-time

**Test Steps**:
```
1. Consumer (Tamil speaker): Calls company
2. Consumer: Speaks in Tamil: "நான் உதவி வேண்டும்"
3. ✅ Speech recognized (STT)
4. ✅ Translated to English: "I need help"
5. ✅ Agent hears: English translation
6. Agent: Responds in English: "How can I help you?"
7. ✅ Translated to Tamil: "நான் உனக்கு எப்படி உதவ முடியும்?"
8. ✅ Consumer hears: Tamil translation
9. Emotion preserved (if crying, voice sounds sad)
10. Conversation flows naturally
```

**Expected Result**: ✅
- Real-time translation
- No lag (< 300ms)
- Emotion preserved
- Both understand
- Natural conversation flow

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Translation Quality Metrics**:
```
[ ] Latency (0-300ms): ___ ms
[ ] Accuracy (0-100%): ___ %
[ ] Emotion preserved: YES/NO
[ ] Context understood: YES/NO
[ ] Natural flow: YES/NO
```

---

## 🟣 C2C SYSTEM TEST SCENARIOS

### C2C Scenario 1: Two Users Register & Connect

**Objective**: Two peers sign up and connect

**Test Steps** (need 2 devices or browsers):
```
Browser 1 (User A):
1. Navigate to: http://localhost:5000/register/peer
2. Phone: "+91 99999 88888"
3. Password: "Test123!@#"
4. Name: "Raj"
5. ✅ Account created

Browser 2 (User B):
1. Navigate to: http://localhost:5000/register/peer
2. Phone: "+91 99999 77777"
3. Password: "Test456!@#"
4. Name: "Priya"
5. ✅ Account created
```

**Expected Result**: ✅
- Both accounts created
- Both can login
- Profiles visible

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

---

### C2C Scenario 2: Find Friend & Send Invite

**Objective**: User finds peer and sends invite

**Test Steps**:
```
User A (Raj):
1. Dashboard → Find Friends
2. Search by phone: "+91 99999 77777"
3. ✅ User B (Priya) found
4. Click "Send Invite"
5. ✅ Invite sent

User B (Priya):
1. Dashboard → Invites → Pending
2. ✅ Invite from Raj visible
3. Click "Accept"
4. ✅ Now connected
```

**Expected Result**: ✅
- Find works by phone
- Invite sent
- Invite received
- Connection established
- Both can now call

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

---

### C2C Scenario 3: Peer-to-Peer Video Call

**Objective**: Two peers make a P2P video call

**Test Steps** (2 devices or windows):
```
User A (Raj):
1. Dashboard → Contacts → Priya
2. Click "Video Call"
3. ✅ Ringing sound, waiting for accept

User B (Priya):
1. Dashboard → Incoming Calls
2. ✅ Ring from Raj
3. Click "Accept Call"
4. ✅ Video call connects
5. Both can see video
6. Both can hear audio

During Call:
- Speak for 2 minutes
- Test video quality
- Test audio quality
- Check for lag
- Check for drops

Call End:
- User A: Click "End Call"
- ✅ Call disconnects
- Both return to dashboard
```

**Expected Result**: ✅
- Call connects < 2 seconds
- Video: HD quality
- Audio: Clear, no echo
- No drops
- Smooth disconnection

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

**Call Quality**:
```
[ ] Video quality (1-10): ___
[ ] Audio quality (1-10): ___
[ ] Lag (0-500ms): ___
[ ] Drops: ___
```

---

### C2C Scenario 4: Group Call (3+ Peers)

**Objective**: Three or more peers in one call

**Prerequisites**: Create 3+ peer accounts first

**Test Steps**:
```
User A: Initiate call
1. Click "Start Group Call"
2. Invite: User B, User C
3. ✅ Invites sent

User B & C: Accept
1. See incoming group call invite
2. Click "Accept"
3. ✅ All three connected

During Call:
- All can see 3 video streams
- All can hear all voices
- No cross-talk
- Clear audio mixing

Notes:
- Monitor bandwidth usage
- Monitor CPU usage
- Check for lags
```

**Expected Result**: ✅
- All 3 connect
- Video streams show
- Audio clean
- No bandwidth issues

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

---

### C2C Scenario 5: Call Recording (Consent)

**Objective**: Recording works with consent from both users

**Test Steps**:
```
During P2P Call:
1. Initiator gets popup: "Record this call?"
2. Click "Yes"
3. ✅ Other user notified: "This call is being recorded"
4. Other user must accept
5. Both agree: Recording starts
6. Red "REC" indicator appears
7. Speak for 1 minute
8. End call
9. ✅ Recording saved
10. Both users can access recording in history
```

**Expected Result**: ✅
- Permission requested
- Both must consent
- Recording saved
- Both can access
- Recording quality good

**Actual Result**:
- [ ] SUCCESS
- [ ] FAILED
- [ ] PARTIAL

---

## 🌐 MULTI-LANGUAGE TEST MATRIX

### Language Test: Hindi to English

**Setup**:
```
Consumer (Hindi speaker): Calls company (English speaking agents)
```

**Test**:
```
1. Consumer: Speaks in Hindi
   "मुझे मदद चाहिए"
   (Translation: "I need help")

2. ✅ STT recognizes Hindi
3. ✅ OpenAI translates to English
4. ✅ Agent hears: "I need help"
5. Agent: Responds in English
   "How can I help?"
6. ✅ ElevenLabs synthesizes in Hindi
7. ✅ Consumer hears Hindi voice: "मैं आपकी कैसे मदद कर सकता हूँ"
```

**Metrics**:
```
[ ] STT Accuracy: ___ %
[ ] Translation Accuracy: ___ %
[ ] TTS Quality: ___ /10
[ ] Latency: ___ ms
[ ] Emotion preserved: YES/NO
```

**Test All 15 Languages** (repeat above for each):

| Language | STT ✓ | Translation ✓ | TTS ✓ | Quality |
|----------|-------|---------------|-------|---------|
| English | [ ] | [ ] | [ ] | ___/10 |
| Hindi | [ ] | [ ] | [ ] | ___/10 |
| Tamil | [ ] | [ ] | [ ] | ___/10 |
| Telugu | [ ] | [ ] | [ ] | ___/10 |
| Kannada | [ ] | [ ] | [ ] | ___/10 |
| Malayalam | [ ] | [ ] | [ ] | ___/10 |
| Punjabi | [ ] | [ ] | [ ] | ___/10 |
| Marathi | [ ] | [ ] | [ ] | ___/10 |
| Gujarati | [ ] | [ ] | [ ] | ___/10 |
| Bengali | [ ] | [ ] | [ ] | ___/10 |
| Spanish | [ ] | [ ] | [ ] | ___/10 |
| French | [ ] | [ ] | [ ] | ___/10 |
| German | [ ] | [ ] | [ ] | ___/10 |
| Portuguese | [ ] | [ ] | [ ] | ___/10 |
| Chinese | [ ] | [ ] | [ ] | ___/10 |

---

## 🔐 PERMISSIONS TEST (Mobile)

### Android Permissions Test

```
[ ] Camera
    └─ Behavior: When user denies
       [ ] App gracefully handles
       [ ] User can enable in settings
       [ ] Video call shows placeholder

[ ] Microphone
    └─ Behavior: When user denies
       [ ] Audio calls fail gracefully
       [ ] User can enable in settings
       [ ] Message shown to enable mic

[ ] Location
    └─ Behavior: When user denies
       [ ] Non-critical features work
       [ ] Can request again later
       [ ] Location features disabled

[ ] Contacts
    └─ Behavior: When user denies
       [ ] Friend search unavailable
       [ ] Can retry from settings
       [ ] No crash

[ ] Storage
    └─ Behavior: When user denies
       [ ] Cannot save recordings
       [ ] Cannot download files
       [ ] Message shown
```

### iOS Permissions Test

(Same as Android above)

---

## 📋 COMPREHENSIVE AUDIT CHECKLIST

### Code Quality Checks
```
Backend:
☐ No console.log in production code
☐ Error handling on all APIs
☐ Input validation on all endpoints
☐ Database connection pooling
☐ Environment variables not hardcoded
☐ API rate limiting configured
☐ CORS properly configured

Frontend:
☐ No console.log in build
☐ Error boundaries around features
☐ Loading states on all async operations
☐ Empty states handled
☐ No memory leaks (test with React DevTools)
☐ Images optimized (< 1MB)
☐ Lazy loading implemented

Mobile:
☐ No debug logs in release build
☐ Permissions handled gracefully
☐ Network timeouts configured
☐ Proper error messages
☐ Battery optimization enabled
☐ Memory management optimized
```

### Security Checks
```
☐ No API keys in code
☐ Passwords hashed (not plain text)
☐ JWT tokens with expiry
☐ HTTPS enforced
☐ CORS not set to *
☐ SQL injection prevented
☐ XSS prevention enabled
☐ Rate limiting on login
☐ Session timeout configured
☐ Database backups encrypted
```

### Performance Checks
```
☐ API response < 200ms
☐ Database queries < 100ms
☐ WebSocket latency < 50ms
☐ Call setup < 2 seconds
☐ Translation < 300ms
☐ Bundle size < 500KB
☐ Startup time < 3s (mobile)
☐ Memory usage < 200MB
```

---

## 📊 QUICK TEST REPORT TEMPLATE

```
═══════════════════════════════════════════════════════
       QUICK TEST REPORT - [DATE]
═══════════════════════════════════════════════════════

TESTER: _______________
DATE: _______________
ENVIRONMENT: localhost:5000

B2B TESTS:
  ✓ Company Registration: [ ] PASS [ ] FAIL
  ✓ Agent Onboarding: [ ] PASS [ ] FAIL
  ✓ Agent-to-Agent Call: [ ] PASS [ ] FAIL
  ✓ Billing: [ ] PASS [ ] FAIL
  ✓ Analytics: [ ] PASS [ ] FAIL

B2C TESTS:
  ✓ Consumer Registration: [ ] PASS [ ] FAIL
  ✓ Payment/Recharge: [ ] PASS [ ] FAIL
  ✓ Company Search: [ ] PASS [ ] FAIL
  ✓ Make Call: [ ] PASS [ ] FAIL
  ✓ Translation: [ ] PASS [ ] FAIL
  ✓ Billing: [ ] PASS [ ] FAIL

C2C TESTS:
  ✓ User Registration: [ ] PASS [ ] FAIL
  ✓ Find Friend: [ ] PASS [ ] FAIL
  ✓ P2P Call: [ ] PASS [ ] FAIL
  ✓ Group Call: [ ] PASS [ ] FAIL
  ✓ Recording: [ ] PASS [ ] FAIL

LANGUAGES: ___/15 working

CRITICAL ISSUES FOUND:
1. _______________
2. _______________
3. _______________

NOTES:
_______________

NEXT STEPS:
1. _______________
2. _______________
```

---

**Now proceed with executing these test scenarios systematically. Document all findings in Excel for analysis.**

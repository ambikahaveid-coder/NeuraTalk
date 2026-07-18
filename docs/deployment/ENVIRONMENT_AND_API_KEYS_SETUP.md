# 🔐 Production API Keys & Environment Setup

**Critical Document**: Contains sensitive configuration instructions  
**Access Level**: Developers only  
**Update Frequency**: Add keys as services are obtained

---

## TABLE OF CONTENTS

1. [Twilio SMS Setup](#twilio-sms-setup)
2. [OpenAI Whisper Setup](#openai-whisper-setup)
3. [ElevenLabs Voice Synthesis](#elevenlabs-voice-synthesis)
4. [Razorpay Payments](#razorpay-payments)
5. [Firebase Authentication](#firebase-authentication)
6. [Complete .env Template](#complete-env-template)
7. [Validation Checklist](#validation-checklist)

---

## TWILIO SMS SETUP

### Step 1: Create Twilio Account

1. Go to: https://www.twilio.com/console/getting-started/sms
2. **Sign up** for free account
   - Email verification required
   - Phone number verification required
3. **After signup**, you get:
   - Account SID (starts with AC)
   - Auth Token (long alphanumeric string)
   - Free trial: $17 USD credit

### Step 2: Get Trial Phone Number

1. Console → Phone Numbers → Buy Numbers
2. Select country: **India**
3. Features: **SMS Capable**
4. Choose number (e.g., +91-9876543210)
5. Buy: ₹150-300 (or use free trial)

**Result**: You now have outgoing SMS rights

### Step 3: Add Verified Recipients (Trial Account Only)

⚠️ **Trial accounts can only SMS verified numbers**

1. Console → Verify Numbers / Phone Numbers
2. Add your test phone numbers:
   - Your personal phone
   - Team members' phones
3. Verification: Click link in SMS received

### Step 4: Extract Credentials

```
From Twilio Console:
- TWILIO_ACCOUNT_SID = ACxxxxxxxxxxxxx (from Account Info)
- TWILIO_AUTH_TOKEN = authxxxxxxxxxx (from Account Info)
- TWILIO_PHONE_NUMBER = +1234567890 (from Purchased Numbers)
```

### Step 5: Test Twilio Connection

```bash
# Install Twilio CLI
npm install -g twilio-cli

# Authenticate
twilio login

# Send test SMS
twilio api:core:messages:create \
  --to "+919876543210" \
  --body "Test OTP: 123456"

# Response: {
#   "sid": "SMxxxxx",
#   "status": "accepted",  ← SUCCESS
#   "to": "+919876543210"
# }
```

### Cost Estimation

- **SMS to India**: ₹1-2 per message
- **Expected usage**: 5-10 messages/user/month
- **For 10,000 users**: ₹50,000-100,000/month
- **Trial credit**: $17 = ~₹1,400 (good for testing)

---

## OPENAI WHISPER SETUP

### Step 1: Create OpenAI Account

1. Go to: https://platform.openai.com/signup
2. **Sign up** with email
3. Email verification required
4. Phone verification required (optional for extra security)

### Step 2: Add Payment Method

1. Account → Billing Overview
2. **Add payment method**:
   - Credit card (Visa/Mastercard)
   - Debit card
   - UPI (for India)
3. **Set usage limits** (IMPORTANT!):
   - Hard limit: $100/month (prevents surprise charges)
   - Soft limit: $50/month (email alert)

### Step 3: Get API Key

1. API Keys page: https://platform.openai.com/api-keys
2. **Create new secret key**:
   - Click "Create Secret Key"
   - Name: `NeuraTalk Backend`
   - Copy immediately (won't show again!)
3. Store safely in `.env` file

### Step 4: Understand Pricing

**Whisper Speech-to-Text**:
- Cost: $0.006 per minute of audio
- Max audio: 25MB per request
- Response time: 2-10 seconds

**GPT-4 Translation**:
- Input: $0.03 per 1K tokens
- Output: $0.06 per 1K tokens
- 1 minute speech ≈ 500 tokens

**Example**: 
- User makes 5-minute call
- Speech-to-text: 5 min × $0.006 = $0.03
- Translation: ~2,500 tokens × $0.03/1K = $0.075
- **Total per call: $0.105 (~₹8.50/call)**

### Step 5: Test OpenAI API

```bash
# Create test script
cat > test-openai.js << 'EOF'
const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testWhisper() {
  // Use example audio file
  const audioFile = fs.createReadStream('./test-audio.wav');
  
  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
  });

  console.log('✅ Whisper working:', transcription.text);
}

testWhisper().catch(err => {
  console.error('❌ Error:', err.message);
});
EOF

# Run test
node test-openai.js
```

### Step 6: Monitor Usage

1. Dashboard: https://platform.openai.com/dashboard
2. Check monthly usage:
   - Whisper usage
   - GPT-4 usage
   - Cost breakdown
3. Set up alerts:
   - Email when 50% usage reached
   - Email when 75% usage reached

---

## ELEVENLABS VOICE SYNTHESIS

### Step 1: Create ElevenLabs Account

1. Go to: https://elevenlabs.io/app/sign-up
2. **Sign up** with email
3. Email verification
4. Phone verification (0ptional)

### Step 2: Get API Key

1. Settings → API Keys
2. **Create new API key**
3. Copy and store in `.env`

```
ELEVENLABS_API_KEY = pk_xxxxxxxxxxxx
```

### Step 3: Get Voice IDs

1. Voices → Browse → View All
2. For each language you support:
   - English: "21m00Tcm4TlvDq8ikWAM" (built-in)
   - Hindi: Need to clone/purchase Hindi voice
   - Telugu: Need to clone/purchase Telugu voice

3. For voice cloning:
   - Upload 15+ minutes of audio
   - Wait for processing (24-48 hours)
   - Get unique voice ID

### Step 4: Pricing

- **Premium voice synthesis**: $5-99/month plans
- **Character-based**: $0.30 per 1K characters (~₹25/hour of audio)
- **Voice cloning**: $99/month (included in higher plans)

### Step 5: Test ElevenLabs API

```bash
# Test voice synthesis
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM" \
  -H "xi-api-key: YOUR_ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, this is a test message",
    "model_id": "eleven_monolingual_v1",
    "voice_settings": {
      "stability": 0.5,
      "similarity_boost": 0.75
    }
  }' \
  --output audio.mp3

# If successful: audio.mp3 created with synthesized speech
# If error: Check API key and voice ID
```

---

## RAZORPAY PAYMENTS

### Step 1: Create Razorpay Account

1. Go to: https://razorpay.com
2. **Sign up** with email
3. Business verification:
   - PAN number
   - GSTIN (if applicable)
4. Bank account verification:
   - Account number
   - IFSC code
   - Account holder name

### Step 2: Get API Keys (Test & Live)

1. Settings → API Keys
2. You get two sets:
   - **Test Keys**: For development (never charges money)
   - **Live Keys**: For production (real money)

```
Example Test Keys:
RAZORPAY_KEY_ID = rzp_test_1Aa00000000001
RAZORPAY_KEY_SECRET = wzsWDv01M2QKqqqqqqqqqqq

Example Live Keys:
RAZORPAY_KEY_ID = rzp_live_1Aa00000000001
RAZORPAY_KEY_SECRET = wzsWDv01M2QKqqqqqqqqqqq
```

### Step 3: Setup Webhooks (Production)

1. Settings → Webhooks
2. **Add webhook endpoint**:
   - URL: `https://your-api.com/api/payments/webhook`
   - Active: ✅
   - Events: 
     - `payment.authorized`
     - `payment.failed`
     - `subscription.created`

3. Razorpay will POST payment updates to your endpoint

### Step 4: Test Payment Flow

```bash
# Use test keys
# Run Flutter app
# Tap "Buy Pro Plan"
# Razorpay modal opens
# Enter test card:
#   Number: 4111 1111 1111 1111
#   Expiry: 12/25
#   CVV: 123
# Click Pay
# ✅ Payment authorized successfully (no charge)
```

### Step 5: Pricing

- **Base**: 2% + ₹0 per transaction (online)
- **Subscriptions**: 1% + ₹0 per transaction
- **Minimum**: ₹1 per transaction
- **No monthly fee**

**Example**: ₹299 Pro Plan
- Razorpay fee: (299 × 2%) + 0 = ₹6
- You receive: ₹293

---

## FIREBASE AUTHENTICATION

### Step 1: Create Firebase Project

1. Go to: https://console.firebase.google.com
2. **Create new project**:
   - Name: `NeuraTalk`
   - Analytics: Optional
   - Region: asia-southeast1 (for India)

### Step 2: Enable Phone Authentication

1. Authentication → Get Started
2. Sign-in method → Phone
3. Enable: ✅
4. Optional: Add reCAPTCHA

### Step 3: Download Service Account Key

1. Settings (gear icon) → Service Accounts
2. **Generate new private key**:
   - Downloads `neuratalk-firebase-key.json`
   - **Keep this secure!** Never commit to Git

### Step 4: Add to Backend

```bash
# Save to server
mv neuratalk-firebase-key.json server/firebase-key.json

# Add to .env
FIREBASE_SERVICE_ACCOUNT_KEY=$(cat server/firebase-key.json)

# Or store in environment variable separately
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/firebase-key.json"
```

### Step 5: Enable Crashlytics

1. Crashlytics → Enable
2. Android app → Upload google-services.json
3. iOS app → Download GoogleService-Info.plist
4. Wait for first session to report

### Step 6: Test Firebase Auth

```bash
# Build app with Google Services configured
flutter build apk --debug

# Install on device
adb install app-debug.apk

# Open app → Login with phone
# Firebase sends REAL SMS with OTP
# Verify it works
```

---

## COMPLETE .ENV TEMPLATE

**Save this as `server/.env`**:

```bash
# ============================================================================
# PRODUCTION API CONFIGURATION - NEURATALK
# ============================================================================
# ⚠️  CRITICAL: Never commit .env to Git
# ⚠️  CRITICAL: Never share API keys on Slack/email
# ============================================================================

# SERVER CONFIGURATION
NODE_ENV=production          # production | development
PORT=5000                    # Server port
LOG_LEVEL=info              # debug | info | warn | error

# DATABASE
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/neuratalk
MONGODB_TIMEOUT=30000       # 30 seconds

# AUTHENTICATION - FIREBASE
FIREBASE_PROJECT_ID=neuratalk-f8345
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"your-project-id","private_key_id":"REDACTED","private_key":"REDACTED_PRIVATE_KEY","client_email":"firebase-adminsdk@example.iam.gserviceaccount.com","client_id":"REDACTED","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token"}'

# JWT TOKENS
JWT_SECRET=your-super-secret-256-bit-key-change-this-to-random-string
JWT_EXPIRY=30d              # 30 days

# SMS PROVIDER - TWILIO
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here_36_characters_long
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_MAX_RETRIES=3
TWILIO_TIMEOUT=30000

# SPEECH-TO-TEXT & TRANSLATION - OPENAI
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
OPENAI_MODEL=gpt-4
OPENAI_WHISPER_MODEL=whisper-1
OPENAI_MAX_TOKENS=4096
OPENAI_TEMPERATURE=0.7

# PAYMENTS - RAZORPAY
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key_here
RAZORPAY_WEBHOOK_SECRET=webhook_secret_from_dashboard
RAZORPAY_CURRENCY=INR

# VOICE SYNTHESIS - ELEVENLABS
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ELEVENLABS_VOICE_ID_EN=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_VOICE_ID_HI=your_hindi_voice_id_here
ELEVENLABS_VOICE_ID_TE=your_telugu_voice_id_here
ELEVENLABS_MODEL=eleven_monolingual_v1
ELEVENLABS_STABILITY=0.5
ELEVENLABS_SIMILARITY_BOOST=0.75

# CORS & SECURITY
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
CORS_CREDENTIALS=true
RATE_LIMIT_WINDOW=15                # minutes
RATE_LIMIT_MAX_REQUESTS=100         # per window

# STORAGE (for audio files)
STORAGE_TYPE=firebase              # firebase | aws-s3 | local
STORAGE_BUCKET=neuratalk-f8345.appspot.com
STORAGE_PATH=/uploads

# MONITORING & LOGGING
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
LOG_TO_FILE=true
LOG_FILE_PATH=/var/log/neuratalk/
ENABLE_REQUEST_LOGGING=true

# CACHE
REDIS_URL=redis://localhost:6379
CACHE_TTL=3600              # 1 hour

# EMAIL (for support/notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password
NOTIFICATION_EMAIL=support@neuratalk.com

# FEATURE FLAGS
ENABLE_CALLS=false                  # WebRTC signaling not yet implemented
ENABLE_TRANSLATION=true
ENABLE_PAYMENTS=true
ENABLE_VOICE_CLONE=false            # Requires ElevenLabs voice cloning

# VERSION
APP_VERSION=2.0.0
API_VERSION=v1
BUILD_NUMBER=100
```

---

## VALIDATION CHECKLIST

Before deploying, verify each service:

- [ ] **Twilio**
  - [ ] Account SID found in console
  - [ ] Auth token copied (doesn't contain spaces)
  - [ ] Phone number purchased and shows incoming SMS capability
  - [ ] Test SMS sent successfully
  - [ ] Cost estimate: ₹1-2 per SMS in India

- [ ] **OpenAI**
  - [ ] API key obtained and stored securely
  - [ ] Payment method added (won't auto-charge)
  - [ ] Usage limits set (hard: $100, soft: $50)
  - [ ] Test request succeeds (using Whisper)
  - [ ] Cost estimate: $0.006/min for Whisper

- [ ] **ElevenLabs**
  - [ ] Account created and verified
  - [ ] API key obtained
  - [ ] Voice IDs identified (at least English: 21m00Tcm4TlvDq8ikWAM)
  - [ ] Test synthesis succeeds (generates MP3/WAV)
  - [ ] Cost estimate: Plan costs $5-99/month

- [ ] **Razorpay**
  - [ ] Account fully verified (PAN, GSTIN, Bank)
  - [ ] Test AND Live keys obtained
  - [ ] Webhook URL configured (for production)
  - [ ] Test payment processed (with test card)
  - [ ] Settlement account active

- [ ] **Firebase**
  - [ ] Project created in correct region
  - [ ] Phone Auth enabled
  - [ ] Service account key downloaded
  - [ ] google-services.json added to Android project
  - [ ] Crashlytics enabled
  - [ ] Test crash reported successfully

- [ ] **.env File**
  - [ ] All 15+ keys filled in
  - [ ] No mistakes in copying (especially long keys)
  - [ ] File permissions: chmod 600 .env
  - [ ] Added to .gitignore
  - [ ] Tested that server starts with .env values

---

## QUICK REFERENCE: WHERE TO FIND EACH KEY

| Service | Key Name | Where to Find |
|---------|----------|---------------|
| Twilio | TWILIO_ACCOUNT_SID | console.twilio.com → Account Info |
| Twilio | TWILIO_PHONE_NUMBER | console.twilio.com → Phone Numbers |
| OpenAI | OPENAI_API_KEY | platform.openai.com → API Keys |
| ElevenLabs | ELEVENLABS_API_KEY | elevenlabs.io → Settings → API Keys |
| ElevenLabs | Voice IDs | elevenlabs.io → Voices → Browse |
| Razorpay | RAZORPAY_KEY_ID | dashboard.razorpay.com → Settings → API Keys |
| Firebase | Service Account | firebase.google.com → Project Settings → Service Accounts |

---

## TROUBLESHOOTING SETUP

### "API Key Invalid" Error

```
Solution:
1. Copy key again carefully (no extra spaces)
2. Check key hasn't been rotated (generate new one)
3. Check key format matches expected length
4. Test with service's own CLI (twilio, openai, etc.)
```

### "Unauthorized Error" on Payment

```
Solution:
1. Check you're using LIVE keys in production (not TEST)
2. Verify Razorpay merchant activation complete
3. Check webhook signature matches
4. Verify payment method enabled for your account
```

### "SMS Not Arriving"

```
Solution:
1. Check Twilio account has credit ($17+ for trial)
2. On trial? Add recipient phone to verified list
3. Check number format: +91XXXXXXXXXX (valid India number)
4. Check Twilio logs for failed messages
5. Try different SMS provider if Twilio fails
```

### "Whisper Timeout"

```
Solution:
1. Check audio file size < 25MB
2. Try smaller chunks (<30 sec audio)
3. Check OpenAI API status: status.openai.com
4. Check your account isn't rate-limited
5. Add retry logic in backend (3-5 retries)
```

---

## SECURITY BEST PRACTICES

✅ **DO:**
- Store all keys in `.env` (never in code)
- Rotate keys periodically (monthly)
- Use separate keys for dev/prod
- Monitor API usage daily
- Set spending limits
- Log failed auth attempts
- Use environment variables in deployment

❌ **DON'T:**
- Hardcode keys in source code
- Share keys via email/Slack/chat
- Commit .env to Git repository
- Reuse keys across projects
- Leave old keys active
- Log API keys or tokens
- Share dev keys with external teams

---

## ENVIRONMENTAL VARIABLES FOR DEPLOYMENT

### Heroku Deployment

```bash
heroku config:set TWILIO_ACCOUNT_SID=ACxxxxxx
heroku config:set OPENAI_API_KEY=sk-projxxx
# ... (set all other keys)
```

### AWS EC2 / Docker

```bash
# Create .env file with all keys
# Store in `/etc/neuratalk/.env`
# Ensure permissions: chmod 600 /etc/neuratalk/.env

# In systemd service file:
# EnvironmentFile=/etc/neuratalk/.env
```

### GitHub Secrets (for CI/CD)

```yaml
# .github/workflows/deploy.yml
env:
  TWILIO_ACCOUNT_SID: ${{ secrets.TWILIO_ACCOUNT_SID }}
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  # ... add all secrets
```

---

Ready to setup? Start with Twilio (simplest), then add OpenAI, then Razorpay. Good luck! 🚀

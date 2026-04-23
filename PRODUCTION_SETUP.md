# 🚀 NEURATALK - COMPLETE PRODUCTION SETUP GUIDE

**Everything you need to deploy NeuraTalk to production** ✅

---

## **TIMELINE: 2-3 Days to Go LIVE**

```
Day 1 (4 hours): Setup APIs & Credentials
Day 2 (6 hours): Deploy Backend & Test
Day 3 (2 hours): Final testing & submission
```

---

## **STEP 1: Firebase Setup** (30 minutes) 🔥

### **1.1 Create Firebase Project**
```
1. Go to: https://console.firebase.google.com
2. Click "Add Project"
3. Project name: "NeuraTalk"
4. Accept terms → Create Project
5. Wait for creation (2-3 minutes)
```

### **1.2 Create Android App**
```
1. Click "Android" icon
2. Package name: com.Mindwhile.neuratalk
3. App nickname: NeuraTalk (optional)
4. Click "Register app"
5. Download google-services.json
6. Place file in: flutter_app/android/app/google-services.json
```

### **1.3 Configure Firebase Authentication**
```
1. Go to: Authentication → Sign-in method
2. Enable: Phone
3. Enable: Email/Password (optional)
4. Leave default settings
```

### **1.4 Download Service Account Key** (for backend)
```
1. Go to: Project Settings → Service Accounts
2. Click "Generate new private key"
3. File auto-downloads as .json
4. Rename to: firebase-service-account.json
5. Place in: server/firebase-service-account.json
6. KEEP IT SECRET! 🔒
```

---

## **STEP 2: Razorpay Setup** (20 minutes) 💳

### **2.1 Create Razorpay Account**
```
1. Go to: https://razorpay.com (register for India)
2. Verify email + phone
3. Go to: https://dashboard.razorpay.com/
4. Navigate to: Settings → API Keys
```

### **2.2 Get API Keys**
```
1. Copy: Key ID (starts with rzp_live_)
2. Copy: Key Secret (keep secret 🔒)
3. Add to server/.env:
   RAZORPAY_KEY_ID=rzp_live_xxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxx
```

### **2.3 Setup Webhooks** (Optional but recommended)
```
1. Go to: Settings → Webhooks
2. URL: https://your-backend.com/webhooks/razorpay
3. Events: payment.authorized, payment.failed
4. This auto-verifies payments in real-time
```

---

## **STEP 3: OpenAI Setup** (10 minutes) 🤖

### **3.1 Get OpenAI API Key**
```
1. Go to: https://platform.openai.com/account/api-keys
2. Login/Create account
3. Click "Create new secret key"
4. Copy and save (you won't see it again!)
5. Add to server/.env:
   OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
```

### **3.2 Enable Whisper API**
```
1. Go to: Settings → Billing
2. Add payment method (credit card)
3. Set usage limits (e.g., $10/month for testing)
4. You have $5 free credits (use for testing)
```

---

## **STEP 4: ElevenLabs Voice Setup** (10 minutes) 🎙️

### **4.1 Create ElevenLabs Account**
```
1. Go to: https://elevenlabs.io
2. Sign up (free account gives 10,000 characters/month)
3. Go to: Account → API Key
4. Copy your API key
5. Add to server/.env:
   ELEVENLABS_API_KEY=xxxxxxxxxxxxxxxx
```

### **4.2 Choose Voice Models**
```
1. Go to: Voice Library
2. Select voices for different languages
3. Test with sample text
4. API will use "default" voice if not specified
```

---

## **STEP 5: MongoDB Setup** (15 minutes) 📊

### **5.1 Create MongoDB Cluster**
```
1. Go to: https://www.mongodb.com/cloud/atlas
2. Sign up → Create free account
3. Click "Build Cluster" → Choose FREE tier
4. Select region (closest to your users)
5. Create username/password for database
6. Wait 5 minutes for cluster to deploy
```

### **5.2 Get Connection String**
```
1. Click "Connect"
2. Choose "Connect your application"
3. Select: Node.js + version 4.0 or later
4. Copy connection string:
   mongodb+srv://username:password@cluster.mongodb.net/neuratalk
5. Replace <password> with your actual password
6. Add to server/.env:
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/neuratalk
```

---

## **STEP 6: Deploy Backend Server** (1 hour) 🖥️

### **Option A: Deploy to Render (Recommended - FREE)**

```bash
# 1. Install Node packages
cd server
npm install

# 2. Push to GitHub
git init
git add .
git commit -m "NeuraTalk Backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/neuratalk-backend.git
git push -u origin main

# 3. Go to: https://render.com
# 4. Click "New +" → "Web Service"
# 5. Connect GitHub account
# 6. Select repo: neuratalk-backend
# 7. Settings:
#    - Name: neuratalk-api
#    - Environment: Node
#    - Build: npm install
#    - Start: npm start
# 8. Add environment variables (.env):
#    - Paste all from server/.env
# 9. Click "Create Web Service"
# 10. Wait 5 minutes for deployment
# 11. Copy your URL: https://neuratalk-api.onrender.com
```

### **Option B: Deploy to Heroku**

```bash
# 1. Install Heroku CLI
# 2. Login: heroku login
# 3. Create app: heroku create neuratalk-api
# 4. Set environment variables:
#    heroku config:set RAZORPAY_KEY_ID=rzp_live_xxx
#    heroku config:set RAZORPAY_KEY_SECRET=xxx
#    (repeat for all .env variables)
# 5. Deploy: git push heroku main
# 6. View logs: heroku logs --tail
# 7. Get URL: heroku apps
```

### **Option C: Deploy to Railway (NEW)**

```bash
# 1. Go to: https://railway.app
# 2. Click "Start a New Project"
# 3. Connect GitHub
# 4. Select repo: neuratalk-backend
# 5. Auto-detects Node.js
# 6. Add PostgreSQL service (optional)
# 7. Set environment variables
# 8. Auto-deploys on push
```

---

## **STEP 7: Update Flutter App** (15 minutes) 📱

### **7.1 Update API Base URL**

Edit: `flutter_app/lib/services/app_config.dart`

```dart
// Change this line:
static const String _defaultBaseUrl = 'https://your-app.replit.app';

// To:
static const String _defaultBaseUrl = 'https://neuratalk-api.onrender.com';
// (use your actual backend URL)
```

### **7.2 Update Firebase Config**

Already done! google-services.json is in place.

### **7.3 Update Razorpay Keys**

Edit: `flutter_app/lib/services/razorpay_service.dart`

```dart
// Update these:
static const String RAZORPAY_KEY_ID = 'rzp_live_xxxxxxxx';
static const String RAZORPAY_KEY_SECRET = 'xxxxxxxx';
```

---

## **STEP 8: Rebuild & Test** (30 minutes) 🧪

### **8.1 Get Updated Dependencies**
```bash
cd flutter_app
flutter clean
flutter pub get
```

### **8.2 Verify Build**
```bash
flutter build apk --release
# Expected size: 86-95 MB
# Success message: "Built build/app/outputs/flutter-apk/app-release.apk"
```

### **8.3 Test Login**
```
1. Install APK: adb install app-release.apk
2. Open app
3. Login with test phone: +919876543210
4. Should receive OTP in logs (console.log in backend)
5. Enter any 6-digit OTP (hardcoded for testing)
6. Should successfully login
```

### **8.4 Test Payment**
```
1. Go to Subscription screen
2. Click "Subscribe Now" on any plan
3. Payment form should appear (Razorpay)
4. Use test card: 4111 1111 1111 1111
5. Expiry: 12/25, CVV: 123
6. OTP (if asked): 123456
7. Should show "Payment Successful"
```

---

## **STEP 9: Prepare for Google Play Store** (2 hours) 🎮

### **9.1 Create Google Play Account**
```
1. Go to: play.google.com/console
2. Sign in with Google account
3. Pay $25 one-time registration fee
4. Accept developer agreement
```

### **9.2 Create App Listing**
```
1. Click "Create app"
2. Name: NeuraTalk
3. Default language: English
4. App or game: App
5. Free or paid: Free
6. Category: Communication
7. Click "Create"
```

### **9.3 Add Screenshots & Icon**
```
Required:
- Icon (512x512 PNG)
- Feature graphic (1024x500 PNG)
- Screenshots (min 2, max 8)
- 30-second video (optional)

Store in: attached_assets/
```

### **9.4 Fill App Details**
```
- Title: NeuraTalk
- Short description (80 chars): Real-time AI call translation
- Full description (max 4000 chars): [Your description]
- Category: Communication
- Content rating: Moderate
```

### **9.5 Privacy Policy**
```
Create at: https://www.freeprivacypolicy.com
- Include: data collection, usage, storage
- Host on your website
- Add URL to Play store listing
```

### **9.6 Upload APK**
```
1. Go to: Release management → App releases
2. Click "Create release"
3. Upload: app-release.apk
4. Fill rollout (start with 10%, increase over days)
5. Add release notes
6. Review & confirm
```

---

## **STEP 10: Submit for Review** ✅

```
1. Complete all required fields
2. Review "Issues to address"
3. Click "Submit for review"
4. Review takes 24-48 hours (usually)
5. Check email for approval/rejection
6. If rejected, fix issues and resubmit
```

---

## **TROUBLESHOOTING**

### **Backend won't start**
```
1. Check Node.js installed: node --version
2. Check .env file has all required keys
3. Check MongoDB connection: can you ping?
4. View logs: npm start (from server folder)
```

### **Firebase not connecting**
```
1. Verify google-services.json in correct location
2. Check package name matches: com.Mindwhile.neuratalk
3. Rebuild APK after adding file
4. Check Firebase authentication enabled
```

### **Razorpay payment fails**
```
1. Check API keys are correct
2. Verify key is not expired
3. Check amount in paise (₹100 = 10000 paise)
4. Verify signature in RazorpayService
```

### **OTP not receiving**
```
1. Check Twilio credentials in .env
2. Verify phone number format: +91xxxxxxxxxx
3. Check phone number is in test list (free tier)
4. Review Twilio logs for errors
```

---

## **FINAL CHECKLIST BEFORE LAUNCH** ✅

```
Backend:
☑️ All .env variables filled
☑️ Firebase service account added
☑️ MongoDB cluster created
☑️ Backend server deployed
☑️ API endpoints tested
☑️ Webhooks configured

Flutter App:
☑️ google-services.json added
☑️ API base URL updated
☑️ Razorpay keys updated
☑️ APK built successfully
☑️ Tested on real device
☑️ No crashes on login/payment

Google Play Store:
☑️ App listing completed
☑️ Privacy policy added
☑️ Screenshots uploaded
☑️ All required fields filled
☑️ APK uploaded
```

---

## **AFTER LAUNCH - First 30 Days**

```
Week 1: Monitor errors
- Check backend logs
- Fix bugs immediately
- Respond to user feedback

Week 2: Growth marketing
- Share on social media
- Get reviews
- ASO (App Store Optimization)

Week 3-4: Scale up
- Increase rollout to 100%
- Monitor performance
- Plan v1.1 features
```

---

## **COSTS (Monthly Estimate)**

```
Firebase: Free tier (enough for 10K users)
MongoDB: Free tier (enough for 10K users)
Razorpay: Transaction fee (1.5%)
OpenAI: ~₹500 (10K transcriptions)
ElevenLabs: ~₹1000 (100K characters)
Backend (Render): Free tier or $7/month
Total: ~₹1500 + variable costs

At 1000 active users:
- API server: $0-10/month
- Database: $0/month
- Transaction fees: ₹10K × 1.5% = ₹150/month
- APIs: ~₹1500/month
Total: ~$20-30/month for 1000 users

Revenue (1000 users):
- Pro: 100 × ₹299/month = ₹30K/month
- Premium: 50 × ₹3100/year = ₹12K/month
Total: ₹42K/month profit at 1000 users 🎉
```

---

## **SUPPORT**

If you face issues:

1. **Check logs**: View backend logs in deployment platform
2. **Debug locally**: Run `npm start` in server folder
3. **Test endpoints**: Use Postman to test API endpoints
4. **Check Firebase**: Verify service account permissions
5. **Verify payments**: Check Razorpay dashboard

---

**YOU'RE NOW READY TO LAUNCH NEURATALK! 🚀**

Next step: Execute this guide and deploy. Good luck! 💪

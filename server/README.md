# 🚀 NeuraTalk Backend Server

**Complete Node.js Backend for NeuraTalk Mobile App**

---

## **Quick Start**

### **1. Setup Environment**

```bash
# Copy example file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### **2. Install Dependencies**

```bash
npm install
```

### **3. Start Server (Local)**

```bash
npm run dev
# Server runs on http://localhost:5000
```

### **4. Deploy to Production**

See [PRODUCTION_SETUP.md](../PRODUCTION_SETUP.md) for detailed steps.

---

## **API Endpoints**

### **Authentication**

```
POST   /api/auth/otp/request
       {identifier, channel}
       → Sends OTP

POST   /api/auth/otp/verify
       {identifier, channel, code}
       → Verifies OTP & returns token

POST   /api/auth/firebase-verify
       {idToken}
       → Verifies Firebase token

GET    /api/auth/me
       (auth required)
       → Gets current user

POST   /api/auth/logout
       (auth required)
       → Logout user
```

### **Translation**

```
POST   /api/translate/speech
       (auth required, multipart/form-data)
       - audio file
       - fromLanguage
       - toLanguage
       → Returns transcript & translation

POST   /api/translate/text
       {text, fromLanguage, toLanguage}
       → Translates text
```

### **Payments**

```
POST   /api/payments/create-order
       {amount, planId, description}
       → Creates Razorpay order

POST   /api/payments/verify-payment
       {orderId, paymentId, signature, planId}
       → Verifies payment & creates subscription

GET    /api/payments/history
       (auth required)
       → Gets payment history
```

### **Subscriptions**

```
GET    /api/subscriptions/current
       (auth required)
       → Gets active subscription

POST   /api/subscriptions/cancel
       {subscriptionId}
       → Cancels subscription
```

### **Call History**

```
GET    /api/calls/history
       (auth required)
       → Gets user's call history

DELETE /api/calls/:callId
       (auth required)
       → Deletes specific call
```

---

## **Environment Variables**

```env
# Server
PORT=5000
NODE_ENV=production

# Razorpay
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxx

# Firebase
FIREBASE_PROJECT_ID=neuratalk-prod
FIREBASE_DATABASE_URL=https://neuratalk-prod.firebaseio.com

# MongoDB
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/neuratalk

# APIs
OPENAI_API_KEY=sk-xxxxx
ELEVENLABS_API_KEY=xxxxx
JWT_SECRET=your-secret-key

# Twilio (for OTP)
TWILIO_ACCOUNT_SID=xxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxx

# CORS
FRONTEND_URL=https://yourdomain.com
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

---

## **Database Models**

### **User**
- firebaseUid
- phone
- email
- displayName
- role (consumer/business)
- preferredLanguage
- createdAt, updatedAt

### **Subscription**
- userId
- planId (free/pro/premium)
- amount
- orderId (Razorpay)
- paymentId
- startDate, expiryDate
- isActive
- autoRenew

### **CallHistory**
- userId
- contact
- callType (sim/whatsapp/video/face-to-face)
- sourceLanguage, targetLanguage
- transcript
- translation
- duration
- cost

---

## **Important Security Notes**

⚠️ **Never commit .env file to git!**

```bash
# Add to .gitignore
echo .env >> .gitignore
echo firebase-service-account.json >> .gitignore
```

⚠️ **Keep secrets safe**

- Never share RAZORPAY_KEY_SECRET
- Never share FIREBASE private key
- Never expose JWT_SECRET
- Use environment variables, not hardcoded

⚠️ **Enable HTTPS**

All production endpoints must use HTTPS for security.

---

## **Testing**

### **Test OTP Endpoint**

```bash
curl -X POST http://localhost:5000/api/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"identifier":"+919876543210","channel":"sms"}'
```

### **Test Translation with Postman**

1. Open Postman
2. POST to: http://localhost:5000/api/translate/speech
3. Body: form-data
   - audio: [select audio file]
   - fromLanguage: en
   - toLanguage: hi
4. Headers: Authorization: Bearer [token]
5. Send!

---

## **Deployment Platforms**

### **Render (FREE)**
Best for: Beginners, free tier up to 750 hours/month

```bash
1. Push to GitHub
2. https://render.com → New Web Service
3. Connect GitHub → Select repo
4. Deploy automatically
```

### **Railway (FREE)**
Best for: Easy setup, auto-deploys on push

```bash
1. https://railway.app → New Project
2. Connect GitHub
3. Select repo and deploy
```

### **Heroku** (Paid after free tier)
Best for: Production, auto-scaling

```bash
heroku create neuratalk-api
git push heroku main
```

---

## **Monitoring & Logs**

### **On Render**
Dashboard → Logs tab → View real-time logs

### **On Railway**
Project → Logs → View output

### **On Local**
```bash
npm run dev
# Logs print to console
```

---

## **Scaling to 100K Users**

```
Database: Upgrade MongoDB to paid tier (~$57/month)
Server: Upgrade Render to ~$10/month
APIs: OpenAI/ElevenLabs costs increase with usage
CDN: Add Cloudflare (free tier available)
```

---

## **Support**

Having issues? Check:

1. `.env` file has all required variables
2. MongoDB cluster is running
3. Firebase service account is valid
4. API keys are correct (not expired)
5. Backend logs for error messages

---

**Ready to deploy? Follow [PRODUCTION_SETUP.md](../PRODUCTION_SETUP.md) 🚀**

# NeuraTalk Manual Test Checklist

Open browser: **http://localhost:5000**

---

## TEST 1: Landing Page
- [ ] Page loads without errors
- [ ] NEURA chatbot widget appears (bottom-right)
- [ ] Click chatbot, type "What is NeuraTalk?" - should respond
- [ ] "Get Started" button works

## TEST 2: Registration & Login
- [ ] Click "Get Started" or navigate to login
- [ ] Register new account (email + password)
- [ ] After register, dashboard loads
- [ ] Logout and login again with same credentials
- [ ] Check: "Consumer Dashboard" shows up

## TEST 3: Voice Translation Call (MAIN FEATURE)
- [ ] Go to Voice Translation Call page
- [ ] Set "My Language" = English
- [ ] Set "Their Language" = Telugu
- [ ] Click "Create Room" - room ID should appear
- [ ] Click "Start Call"
- [ ] ALLOW microphone permission when browser asks
- [ ] Speak in English: "Hello, how are you?"
- [ ] Check: Translation text appears on screen (Telugu)
- [ ] Check: You hear Telugu voice output
- [ ] Check: Latency shown (should be 1-3 seconds)
- [ ] End call

## TEST 4: Face-to-Face Translation
- [ ] Go to Face-to-Face page
- [ ] Set Person 1 language = English
- [ ] Set Person 2 language = Telugu
- [ ] Tap Person 1 side, speak in English
- [ ] Check: Telugu translation appears + plays audio
- [ ] Tap Person 2 side, speak in Telugu
- [ ] Check: English translation appears + plays audio

## TEST 5: Video Translation Call
- [ ] Go to Video Translation Call page
- [ ] Allow camera + microphone
- [ ] Check: Local video shows
- [ ] Set languages and start call
- [ ] Check: Translation subtitles appear during call

## TEST 6: Website Chatbot
- [ ] Go back to landing page
- [ ] Open NEURA chatbot
- [ ] Ask: "What are the pricing plans?"
- [ ] Ask: "How many languages do you support?"
- [ ] Ask: "Tell me about B2B features"
- [ ] Check: All responses are relevant and helpful

## TEST 7: Billing/Payment
- [ ] Go to Billing page from dashboard
- [ ] Check: Plans are shown with prices
- [ ] Click "Subscribe" on any paid plan
- [ ] Check: Razorpay checkout opens

## TEST 8: Admin Features (if super_admin)
- [ ] Login as super admin
- [ ] Check: Super Admin Dashboard loads
- [ ] Check: User management works
- [ ] Check: Platform settings accessible

---

## KNOWN LIMITATIONS (expected behavior):
- Ultra-low-latency (<100ms) shows "Not Available" - needs GPU servers
- Voice cloning shows "Not Available" - needs Docker + GPU
- Thai language has no TTS voice (text translation works)
- First translation may take 2-3 seconds (cold start), subsequent ones faster
- Two-person call needs two different browsers/devices

## BROWSER REQUIREMENTS:
- Chrome/Edge recommended (best WebRTC support)
- Must allow microphone permission
- Must allow camera for video calls
- HTTPS required for production (localhost works for dev)

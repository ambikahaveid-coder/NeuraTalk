# Quick Start: Contact-Based Calling

## ⚡ Get Started in 2 Minutes

### 1. Start the Application
```bash
# Terminal 1: Backend
cd server
npm run dev
# Should see: "✅ Backend listening on port 5000"

# Terminal 2: Frontend  
cd client
npm run dev
# Should see: "Local: http://localhost:5173"
```

### 2. Open in Browser
```
http://localhost:5173/calls/contact
```

### 3. Add a Test Contact
1. Look for **"Add New Contact"** form at the top
2. Fill in:
   - **Name**: "Test Person"
   - **Identifier**: "test-001" (can be phone, ID, anything)
   - **Language**: Select "Telugu" (or any language)
3. Click **"+ Add Contact"**
4. Contact appears in the list below

### 4. Make a Test Call
1. Find the contact you just added
2. Look for the **"📞 Call"** button on the contact card
3. Click it
4. You'll see: **"Connecting..."** (wait 1-2 seconds)
5. Then: **"✅ Connected"** with timer
6. Speak to test microphone
7. You'll see translations appearing in the panel

### 5. End the Call
1. Click **"End Call"** button (red, with phone icon)
2. Returns to contact list
3. Contact now shows in "Recent Contacts" if you scroll down

### 6. Verify Data Persistence
1. Close the browser tab
2. Reopen: http://localhost:5173/calls/contact
3. Your contacts are still there! ✅
4. Call history is preserved ✅

## 🎯 Test Scenarios

### Scenario A: Multiple Languages
```
Contact 1: "Mom" → Language: Telugu (te)
           Speaks to you in Telugu, you respond in English

Contact 2: "Brother" → Language: Hindi (hi)
           Uses Hindi for family calls

Contact 3: "Office" → Language: English (en)
           Business calls in English
```

### Scenario B: Contact Management
```
1. Add 5 contacts
2. Click star (⭐) on 2 of them to favorite
3. Scroll to "Favorites" section - should show 2
4. Scroll to "Recent" section - shows last called
5. Search for a contact by typing in search box
6. Delete one (click X) - confirmation popup
```

### Scenario C: Real Translation Test
```
1. Add contact "Friend" (Te language)
2. Start call
3. Speak: "Hello, how are you today?"
4. Should see translation: "హలో, మీరు ఈ రోజు ఎలా ఉన్నారు?"
5. Both texts shown in bottom panel
6. Real-time as you speak
```

## 🔧 Troubleshooting

### "Contact not showing"
```
Solution:
1. Check browser console for errors (F12)
2. Clear browser cache (Ctrl+Shift+Delete)
3. Hard refresh (Ctrl+Shift+R)
4. Ensure microphone permission granted
```

### "Connection failed"
```
Solution:
1. Check backend is running (see terminal 1)
2. Verify port 5000 is accessible
3. Check WebSocket URL: should be ws://localhost:5000 (see console)
4. Try: http://localhost:5000 in browser to see "Welcome" message
```

### "No translation showing"
```
Solution:
1. Check microphone is working (test in Windows)
2. Verify translation API is running
3. Check source and target languages are different
4. Look at browser console for API errors
5. Ensure media stream is active
```

### "Contacts lost after refresh"
```
Solution:
1. Check localStorage is enabled
2. Open DevTools (F12) → Application → Storage
3. Look for "neuratalk_contacts" key
4. If empty, data was lost - re-add contacts
5. Don't clear browser cache to preserve contacts
```

## 📊 What's Working ✅

- ✅ Add/view/delete contacts
- ✅ Search and filter contacts  
- ✅ Favorite/unfavorite contacts
- ✅ View recent contacts
- ✅ Call contacts by name
- ✅ Real-time translation display
- ✅ Call duration timer
- ✅ Mute/unmute audio
- ✅ End call cleanly
- ✅ Data persists in localStorage
- ✅ Works offline (no database needed)
- ✅ Error handling and logging
- ✅ Multiple language support

## 🔜 Coming Soon

- 🟡 Call recording
- 🟡 Contact notes
- 🟡 Call history per contact
- 🟡 Call export
- 🟡 Database sync (when Neon online)
- 🟡 B2B organization numbers
- 🟡 Incoming call routing
- 🟡 Team contact sharing

## 🔑 Key URLs

| Feature | URL | Status |
|---------|-----|--------|
| Contact Calls | http://localhost:5173/calls/contact | ✅ Live |
| Dashboard | http://localhost:5173/dashboard | ✅ Live |
| Video Call | http://localhost:5173/calls/video-translation | ✅ Live |
| Face-to-Face | http://localhost:5173/calls/face-to-face | ✅ Live |
| API Docs | http://localhost:5173/api-docs | ✅ Live |

## 💡 Pro Tips

1. **Test with Multiple Browsers**
   - Open different browsers side-by-side
   - One is the "caller", one is "receiver"
   - Simulate real call scenario

2. **Check Console Logs**
   - Press F12 in browser
   - Click "Console" tab
   - See detailed debug logs with [ContactCall] prefix
   - Helps troubleshoot issues

3. **Export Contacts Backup**
   - Coming soon! Will add export button
   - For now, can manually copy from localStorage

4. **Use Different Languages**
   - Each contact can have different language
   - Optimize for who you're calling
   - Especially useful for multilingual teams

5. **Test Microphone First**
   - Go to Windows Settings → Sound
   - Test microphone before trying calls
   - Ensure no other app is using microphone

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `CONTACT_CALLING_INTEGRATION.md` | Complete technical guide |
| `CALL_SYSTEM_ARCHITECTURE_AUDIT.md` | System design & issues |
| `IMMEDIATE_WORKAROUND_CONTACTS.md` | Architecture strategy |
| This file (Quick Start) | Get started in 2 minutes |

## 🎓 Next Steps After Testing

1. **If all tests pass** ✅
   - System is production-ready!
   - Can use for real calls
   - Document any issues found

2. **If issues found** 🐛
   - Note exact steps to reproduce
   - Check browser console logs
   - Share error message + environment
   - We'll fix quickly

3. **For B2B/Companies**
   - Contact calls work with company teams
   - Add each team member as contact
   - When DB is online, each gets branded number
   - Incoming calls routed to correct contact

4. **For Scaling**
   - Current limit: ~1000 contacts max (localStorage 5MB)
   - Database migration planned (Phase 1)
   - Will support unlimited contacts + advanced features

## ✨ Summary

You now have a fully functional **contact-based calling system** that:
- Protects privacy (no number exposure)
- Works offline (no DB needed)
- Supports real-time translation
- Persists data in browser
- Ready for B2B integration
- Future-proof architecture

**Good luck! 🚀**

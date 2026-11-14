# NeuraTalk vs WhatsApp, WhatsApp Business and the WhatsApp Business API

First audit on 13 November 2026, checked against the code. Updated on 14 November 2026 after the gaps were built (21c2137 and the next release).

More tests on 14 Nov: t/102_more_parity.mjs (stickers, friends' UPI, SMS test mode, Private chat with Node-side encryption) 59/59, t/103_ads.mjs 23/23, t/104_more_ui_shots.mjs browser checks; the app decrypts a message sealed by the Node code (same format both sides).

Tests:
- **B2B on a fresh database:** 620 out of 620 checks passed (tmp/e2e-env/t/_b2b_fresh.ps1).
- **New features (parity):** 84/84 end to end (t/100_parity.mjs), plus browser clicks and screenshots (t/101_parity_ui_shots.mjs).
- **Business API:** 49/49 (t/99_business_api.mjs).
- **Server:** 1020/1020. **Web:** 152/152. **App:** 49/49.

Legend: ✅ built and tested · ⚠️ partly, or works differently · ❌ missing

## 1. Personal app (WhatsApp)

| Feature | NeuraTalk | Note |
|---|---|---|
| 1:1 and group chats, replies, mentions, reactions, edit, delete for everyone, forward, star | ✅ | Plus live translation in every chat (WhatsApp has none) |
| Photos, videos, documents, voice messages, location, polls, stickers, contact cards | ✅ | |
| View once, disappearing messages, locked chats, archive, pin, mute | ✅ | |
| Read receipts, typing, last seen | ✅ | |
| Search in chats | ✅ | |
| Voice and video calls, group calls | ✅ | Plus live translated calls and in-person translation |
| **Screen share in calls** | ✅ new | App (Android asks every time) and web (desktop browsers). 1:1 calls. Not yet tried on a real phone. |
| Status (24 h), Channels, Communities | ✅ | |
| **Group invite link + QR** | ✅ new | neuratalk.in/g/…: reset, turn off, join count. Someone an admin removed can't rejoin through the link. Blocks are respected. |
| **Broadcast lists** | ✅ new | Up to 256 people. Each gets a normal 1:1 message. Only reaches people who have messaged you or saved your number (anti-spam, like WhatsApp). 20 sends an hour. |
| **Chat wallpaper** | ✅ new | 8 designs, 12 colours, dim. One for all chats or per chat; the same on phone and web. |
| Linked devices (web), two-step PIN | ✅ | |
| Block, report | ✅ | |
| End-to-end encryption | ⚠️ new | **Private chat** (🔒): X25519 + AES-256-GCM on the phone, server stores only ciphertext, security code, disappearing timer. No translation, phone only (not web), a new phone can't read older private messages. Normal chats stay translated and are encrypted in transit and at rest, not end to end. |
| Chat backup / new phone | ⚠️ | Chats live on the server (India) and come back on login. No separate backup step is needed. |
| Person-to-person payments | ✅ new | Request money / Pay by UPI in 1:1 chats; bank to bank via the person's UPI app; UPI ID shown only to chat contacts |

## 2. Business app (WhatsApp Business)

| Feature | NeuraTalk | Note |
|---|---|---|
| Business profile, logo, hours, address | ✅ | |
| Catalog, collections, cart / orders in chat | ✅ | Product cards with today's price |
| Greeting, away message, quick replies, labels | ✅ | |
| Short link, QR code | ✅ | |
| Broadcasts to customers, with opt-in | ✅ | Templates reviewed by NeuraTalk; daily limits; quality rating |
| Auto-reply bot (keywords, buttons, menu) | ✅ | WhatsApp Business app has no keyword bot |
| Forms in chat | ✅ | |
| Team inbox, assignment, multi-device | ✅ | |
| Verified tick | ✅ | Given after NeuraTalk checks the business |
| **Payments in chat (UPI)** | ✅ new | ₹ button in the chat (app and web). The customer pays straight to the business's UPI ID (Pay button on phone, QR on computer), then taps "I've paid" with the UTR. The business confirms. NeuraTalk never holds money. |
| Calls with customers | ✅ | In-app. Calls to ordinary phone numbers: built, waiting for the owner's Exotel account |
| Reaching customers without the app | ⚠️ new | SMS with a link to read the message (MSG91, one DLT template). Built and tested in test mode; live after MSG91 + DLT approval |
| Statistics | ✅ | |
| Wallet, plans, statement, buying by UPI | ✅ | Online payment (Razorpay) is off; NeuraTalk confirms UTRs |
| Ads (click-to-chat) | ✅ new | NeuraTalk's own "Sponsored" businesses (not Facebook/Instagram): reviewed by NeuraTalk, ₹2 per chat started, daily budget |

## 3. Business API (WhatsApp Cloud API)

| Feature | NeuraTalk (`/api/v1/me`, `/api/v1/messaging`) | Note |
|---|---|---|
| Send text, template, buttons, location, media, reply, reaction | ✅ | Media in two steps: an upload address, then send |
| **Interactive list message** | ✅ new | Up to 10 options in sections; the choice comes back as the customer's reply (webhook + bots) |
| Product message (catalog) | ✅ | Product cards |
| **Contacts message** | ✅ new | Name, phone, company |
| Sticker message | ✅ new | WebP/PNG up to 500 KB |
| **Mark as read**, typing indicator | ✅ new | `POST …/read`; reading history with `?markRead=false` doesn't mark it read |
| **Payment request (UPI)** | ✅ new | Send, list, mark paid/cancelled |
| Templates: create, review, list, send | ✅ | Reviewed by NeuraTalk |
| Webhooks: incoming messages, statuses, button taps, list choices, form answers, orders, calls | ✅ | Signed with a secret |
| Customers, consent, import | ✅ | |
| Business profile | ✅ | |
| Analytics | ✅ | 30-day stats |
| OTP / authentication | ✅ | Delivered in the NeuraTalk app (no SMS) |
| Rate limit | ✅ | 60 requests a minute per key by default; super admin can raise it |
| Reseller / partner (BSP) model | ✅ | Partner panel, wholesale wallet, own brand |

## 4. Not like WhatsApp, and what is still needed from the owner

- **SMS to people without the app:** code done and tested in test mode. To go live: an MSG91 account, TRAI DLT registration of NeuraTalk (entity + header + the one template "{#var#} sent you a message on NeuraTalk. Read it: {#var#}"), then set MSG91_AUTH_KEY, MSG91_SMS_TEMPLATE_ID and SMS_FALLBACK_ENABLED=true in AWS Secrets Manager. Price per SMS: SMS_PRICE_PAISE (default ₹0.25), the owner's decision.
- **Calls to ordinary phone numbers:** built (Exotel/LiveKit SIP); waiting for the owner's Exotel account and keys.
- **End-to-end encryption:** only Private chats. Normal chats can't be end-to-end encrypted while they are translated on the server.
- **Ads:** inside NeuraTalk only. Price per chat started: AD_CHAT_PRICE_PAISE (default ₹2), the owner's decision.
- **Group links opening the app directly:** set ANDROID_APP_SHA256 to the Play app-signing fingerprint (Play Console → App integrity). Until then the website page offers "Open in the NeuraTalk app".
- **Play Console:** declare the screen-capture foreground service (media projection: screen sharing in calls).
- **Card / netbanking checkout:** not built by the owner's choice (UPI only, 0% fee).
- **Reach:** WhatsApp is on almost every phone in India; NeuraTalk has to grow its users. The SMS link page invites people to install NeuraTalk.

## 5. Suggested next work

1. Test on real phones with the new app (screen share, group links, Private chat between two phones, UPI pay).
2. MSG91 + DLT, then switch SMS live.
3. Exotel account, then phone-number calls.

## 6. Beyond WhatsApp: AI assistant (14 Nov 2026)

| Feature | WhatsApp | NeuraTalk |
|---|---|---|
| Personal AI assistant that answers chats when you're busy | ❌ | ✅ says it is your AI assistant, asks what/urgent, summary in "Messages taken" |
| AI assistant that answers calls (missed or while busy, or "Let my assistant answer") | ❌ | ✅ in-app calls; AI voice or your own; max 3 min per call |
| Business AI receptionist in chat and on calls, trained on catalog/prices/hours/FAQ | ❌ (Meta AI for business is limited, not in India apps) | ✅ takes order/booking requests, hands over to a person, quiet while a team member talks |
| Plans | — | Personal 7 days free then ₹99/month (60 call min); business 14 days free then ₹999/month (300 call min, extra ₹6/min). Trial call minutes: 30 / 100. Editable by super admin. |

Tests: t/105_assistant.mjs (51 checks, fixed test brain, no audio) and t/106_assistant_ui.mjs (browser). The real voice path (LiveKit + speech + AI voice) is not yet tried on a phone.

# NeuraTalk vs WhatsApp, WhatsApp Business and the WhatsApp Business API

First audit on 13 November 2026, checked against the code. Updated on 14 November 2026 after the gaps were built.

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
| End-to-end encryption | ❌ | Encrypted in transit and at rest. Translation needs the server to read the text, so it can't be end-to-end. The website says this honestly. |
| Chat backup / new phone | ⚠️ | Chats live on the server (India) and come back on login. No separate backup step is needed. |
| Person-to-person payments | ❌ | Businesses can ask for UPI payments in chat (see 2). Payments between friends aren't built. |

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
| Calls with customers | ✅ | In-app. Calls to ordinary phone numbers need an Exotel account; not live |
| Statistics | ✅ | |
| Wallet, plans, statement, buying by UPI | ✅ | Online payment (Razorpay) is off; NeuraTalk confirms UTRs |
| Ads (click-to-chat ads) | ❌ | |

## 3. Business API (WhatsApp Cloud API)

| Feature | NeuraTalk (`/api/v1/me`, `/api/v1/messaging`) | Note |
|---|---|---|
| Send text, template, buttons, location, media, reply, reaction | ✅ | Media in two steps: an upload address, then send |
| **Interactive list message** | ✅ new | Up to 10 options in sections; the choice comes back as the customer's reply (webhook + bots) |
| Product message (catalog) | ✅ | Product cards |
| **Contacts message** | ✅ new | Name, phone, company |
| Sticker message | ❌ | |
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

## 4. Not like WhatsApp, on purpose or for now

- **Reach:** a NeuraTalk business message only reaches people who have the NeuraTalk app. There's no SMS fallback; the owner chose "not now" on 13 Nov.
- **Calls to ordinary phone numbers:** built with Exotel/LiveKit SIP, but there's no Exotel account yet.
- **End-to-end encryption:** not possible while messages are translated on the server. An optional "private chat without translation" could be end-to-end encrypted; that's a separate, large project.
- **Group links opening the app directly:** the website page opens the app via "Open in the NeuraTalk app" today. To make neuratalk.in/g/… open the app straight away, set `ANDROID_APP_SHA256` to the Play app-signing fingerprint (Play Console → App integrity).
- **Screen share on Play:** Google asks apps that use the screen-capture permission to declare it in Play Console (App content → Foreground service types → "media projection: screen sharing in calls").

## 5. Suggested next work

1. Test screen share and group links on a real phone (new app build needed).
2. Payments between friends (UPI request in 1:1 chats).
3. Sticker messages in the Business API.
4. Optional end-to-end encrypted private chats (no translation).

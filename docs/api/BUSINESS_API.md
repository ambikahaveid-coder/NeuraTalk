# NeuraTalk Business API

For a business's own software: CRM, billing, shop or helpdesk. It works like the WhatsApp Business Cloud API, on NeuraTalk's own platform. Customers read everything inside the NeuraTalk app, in their own language.

## Authentication

- Create an API key in the business dashboard under **Developers**. NeuraTalk activates it after a quick check.
- Send the key in every request as the header `X-API-Key: ntk_ent_…`.
- `GET /api/v1/me` lists every endpoint. "me" is always the key's own business, so a key can never reach another business.
- Requests follow the same rules as the dashboard:
  - **24-hour rule:** free text only to a customer who wrote in the last 24 hours. Otherwise send an approved template.
  - **Templates:** NeuraTalk reviews each one.
  - **Offers:** go only to customers who agreed, within daily limits.
  - **Charges:** paid messages come from your prepaid wallet.
  - **Pause:** NeuraTalk can pause sending. While paused, reading still works and sends answer `PAUSED_BY_NEURATALK`.
- Team, API keys, payments and approvals are dashboard-only.

## Endpoints

| Method | Path | What |
|---|---|---|
| GET | /api/v1/me/conversations | Conversations (`?limit`, `?offset`, `?assignment=all`) |
| POST | /api/v1/me/chats | Start a chat by phone: `{ phone, message }` (24-hour rule) or `{ phone, templateVersionId, variables }` |
| GET | /api/v1/me/conversations/:id | One conversation |
| GET | /api/v1/me/conversations/:id/messages | History. Customer messages carry `translatedContent` in your language. |
| POST | /api/v1/me/conversations/:id/messages | Send (24-hour rule): `{ content }`, `{ buttons:[…≤3] }`, `{ location:{latitude,longitude,name} }`, `{ attachment:{url,mimeType,sizeBytes,title} }`, `{ replyToMessageId }` |
| POST | /api/v1/me/conversations/:id/template | `{ templateVersionId, variables }`, any time |
| POST | /api/v1/me/conversations/:id/products | `{ itemIds:[…≤10] }`: product cards |
| POST | /api/v1/me/conversations/:id/form | `{ formId }` |
| POST | /api/v1/me/conversations/:id/typing | Show "typing…" |
| POST | /api/v1/me/conversations/:id/messages/:mid/reaction | `{ emoji }` |
| PATCH | /api/v1/me/conversations/:id/labels | `{ labels:[…] }` |
| GET | /api/v1/me/conversations/:id/window | Is the 24-hour window open, and until when |
| POST | /api/v1/me/media | `{ name, size, contentType }`. Returns `uploadURL` (PUT the file there) and `objectPath` (send as `attachment.url`). |
| GET, POST | /api/v1/me/customers | List or add customers |
| POST | /api/v1/me/customers/import | Add many |
| GET, PUT | /api/v1/me/customers/:id | Read or update a customer |
| POST | /api/v1/me/customers/:id/archive | Archive |
| GET, POST | /api/v1/me/customers/:id/consent | Read or record consent (`utility`, `marketing`, `authentication`) |
| GET, POST | /api/v1/me/broadcast-templates | Templates and review status, or create (goes to review) |
| GET | /api/v1/me/sendable-templates | Approved templates |
| GET, POST | /api/v1/me/catalog | Catalog |
| PATCH, DELETE | /api/v1/me/catalog/:id | Change or remove an item |
| GET | /api/v1/me/orders | Orders |
| PATCH | /api/v1/me/orders/:id | `{ status }` |
| GET, POST | /api/v1/me/forms | Forms |
| PUT, DELETE | /api/v1/me/forms/:id | Change or remove a form |
| GET | /api/v1/me/forms/:id/responses | Answers |
| GET, POST | /api/v1/me/auto-responders | Auto-reply bots |
| PUT, DELETE | /api/v1/me/auto-responders/:id | Change or remove a bot |
| GET, PATCH | /api/v1/me/profile | Business profile |
| GET | /api/v1/me/account | Account summary |
| GET | /api/v1/me/messaging-stats | Last 30 days: sent, delivered, read, received |
| GET | /api/v1/me/credits | Wallet, plan, prices, spending (read-only) |

## Also available

- `POST /api/v1/messaging/messages`: send by phone number (template or text).
- `GET /api/v1/messaging/messages/:id`: delivery status.
- `POST /api/v1/messaging/otp` and `/otp/:id/verify`: login codes.
- `POST /api/v1/messaging/utility-events`: updates that are safe to retry.
- `GET/POST /api/v1/send`: one-line URL. See [SIMPLE_SEND_API.md](SIMPLE_SEND_API.md).
- **Webhooks** (dashboard → Developers): `message.received`, `message.sent`, `message.delivered`, `message.read`, `message.failed`, `call.*`, each signed with your secret.

## Not offered (honest)

- **SMS to people without NeuraTalk.** Customers need the NeuraTalk app.
- **List menus** (WhatsApp "list messages"). Use up to 3 reply buttons, a form, or product cards.
- **Contact-card and sticker messages from the API.**
- **Payments inside chat.**

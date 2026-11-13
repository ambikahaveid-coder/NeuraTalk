# Business payments: how NeuraTalk sells credit and plans

For the NeuraTalk super admin. Last checked end to end on 13 November 2026.

Online payment (Razorpay) is off. Businesses pay by UPI or bank transfer and send the payment reference. A person at NeuraTalk confirms it.

## What a business pays for

| | What it is | Where it's used |
|---|---|---|
| **Plan** | Monthly. AI translation minutes for business calls, for the plan's days. | Business calls with translation. It does not renew on its own. |
| **Wallet credit** | Prepaid rupees. | Offers, updates, login codes, the Send API, and calls after the plan minutes run out. |

Free for the business:
- replies to a customer who wrote in the last 24 hours
- messages that are not delivered (customer blocked them, turned offers off, or isn't on NeuraTalk)

Customers never pay.

## One-time setup (Super Admin → Business Payments)

1. **Where businesses pay.** Enter Mindwhile IT Solutions' UPI ID and/or bank account and IFSC.
   - Until this is filled, businesses see "write to support@mindwhile.com".
   - Use the company account only.
2. **Credit packs (optional).** For example, Starter: pay ₹500, get ₹500. Growth: pay ₹1,000, get ₹1,050.
   - Bonus credit is promotional: no cash value, not refunded (Business Terms §4).
   - Without packs, a business can still pay any amount from ₹500.
3. **Plans.** Their prices, minutes and days are set in **Billing & Plans**, type "b2b".
   - Only enabled paid plans are offered to businesses.
4. **Standard message prices.** Set in **Companies → Business message prices**.
5. **Special rates (optional).** Set per business in Business Payments → Special rates. Leave a box empty to use the standard price.

## Every day: confirm payments

Super Admin → Business Payments → **Payments to confirm**.

1. Open your bank statement or UPI app. Find the payment with the same **UTR** and **amount**.
2. If it's there, click **Confirm**.
   - **Credit:** the credit is added to the wallet. It's recorded in the wallet ledger and Audit Logs.
   - **Plan:** the plan starts now, with its minutes and end date. If the business was paused only because its plan ended, it is resumed. A business you paused for another reason stays paused.
3. If it's not there, click **Not received** and write why. The business sees your reason and can send a corrected UTR.

Safety built in:
- A UTR can be used only once.
- Two people clicking Confirm at the same time add the credit only once.
- A business can't confirm its own payment.

## When a plan ends

- On the end date, the plan moves to a 7-day **grace** period. The business sees a red banner: "Renew by …".
- After 7 days, the business account is **paused** until a new plan is paid. Its wallet balance is kept.
- From 5 days before the end date, the business sees "Your plan ends on …".

## Bots and API (Super Admin → Bots & API)

- See every business's auto-reply bots, bot replies, API calls, failures and charges for the last 7 days.
- **Pause** a business's bots and/or API sending with a reason, e.g. when customers report spam.
  - The business sees the reason in the dashboard and the app.
  - The API answers `PAUSED_BY_NEURATALK`.
  - Every pause is recorded in Audit Logs.

## Not done yet (be honest with businesses)

- **No automatic GST invoice for these payments.** Issue invoices from your accounting software.
- **No online payment.** When Razorpay is switched on, it can replace manual confirmation.
- **Businesses aren't told by SMS or email** when a plan is about to end. They see it in the app and dashboard only.

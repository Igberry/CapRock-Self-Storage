# CapRock gate codes: how it works, where it stands, what is needed

Prepared 16 September 2026 for the meeting with Chris.

## 1. The problem in one paragraph

WebSelfStorage can push gate codes automatically only to the gate
controllers on its own list (Facility > Gates). CapRock's controllers are
not on that list, and the new system, Alarm.com Access Control, is not
either. U-Haul confirmed in writing on 16 September: no Alarm.com
integration, none planned, no API that exposes gate codes, and no file
export. "Manual" mode stores a code for the office to read and nothing
more. So automatic gate codes are impossible inside WebSelfStorage, and
the only route is to issue them ourselves.

## 2. What we built

A small system that does what a supported gate integration would do,
outside WebSelfStorage:

1. Reads the tenant list (the "rentroll") from the WebSelfStorage API
   every five minutes. This is the same API key the website uses for
   prices, and the rentroll is the one endpoint that returns tenants:
   name, phone, unit, move-in date, paid-through date, balance.
2. Issues one random four-digit gate code per person. One code per
   person, not per unit: a tenant with three units gets one code. Codes
   are never repeated, never start with 0, and never a weak pattern
   like 1234 or 1111.
3. Stores the code in a database (Supabase, project "CapRock Gate
   Codes"), with a full log of every change.
4. Texts the tenant their code, through GHL, so every tenant also ends
   up in the CRM with a "gate-code" tag.
5. Hands the code to the gate controller. This last step is a stub
   until Alarm.com access exists. Until then, every change is sent to
   the office as an alert: "Gate: ADD code 4821 for SMITH, JO (128)",
   and the office keys it in by hand.
6. Suspends the code when a tenant is behind on rent, reinstates it
   when they pay, and removes it when they move out. All automatic,
   from the rentroll.

Nothing on the website is involved. Tenant data never leaves the server.

### The rules in detail

| Situation | What happens |
|---|---|
| New tenant appears in the rentroll | Code issued, texted, sent to controller (or office alert) |
| Tenant already behind on rent when first seen | Code issued but suspended; NOT texted; texted when they pay up |
| Tenant more than 30 days past paid-through with a balance owing | Code suspended, office alerted |
| That tenant pays | Code reinstated, office alerted |
| Tenant's last unit leaves the rentroll | Code revoked, office alerted |
| Tenant adds a second unit | Nothing; same person, same code |
| Nothing changed since last run | Nothing sent, nothing written |

The 30 days is a setting (`SUSPEND_AFTER_DAYS`) and is Chris's call.

### The text message a tenant receives

> CapRock Self Storage: your gate code for unit 128 is 4821. Please
> keep it private. Questions? Call (806) 589-1472.

Wording can change. Gate hours or a keypad instruction ("press # after")
can be added if wanted.

## 3. What happened on 16 September

The plan was four careful steps: rehearse without writing anything;
write codes without texting; text one person (Chris) and check the
message; then go live on a morning the office picked.

Steps one and two went as planned. The rehearsal at 17:50 UTC reported
57 contracts, 47 people, 38 to be issued active codes, 9 to start
suspended for being behind on rent, none without a phone number.

The run at 17:55 UTC (12:55 pm Lubbock) was meant to write the codes
and send nothing. The texting switch (`GATE_TEXTING`) was set to `on`
on that deployment, so it wrote the codes and also sent them:

- 38 tenants were texted their new gate code.
- 9 tenants behind on rent were correctly not texted.
- 38 office alerts were sent to the number set as OFFICE_PHONE.
- Chris's own test tenant record (unit 026) was among the 38, so he
  has the actual message on his phone.

The system did exactly what it is built to do, two steps earlier than
intended. The one-phone safety I had built for step three never got to
apply. At 18:10 UTC the whole thing was paused: the schedule was
removed and a master switch was added so it cannot run again until
someone deliberately turns it on.

### Consequence to manage

Those 38 tenants have a code that does not open the gate yet, because
no controller is connected. Two ways to close that gap, and Chris
should pick one:

- Key the 38 codes into the current controller. They are in the
  `office_list` view in Supabase (name, rooms, code) and were sent as
  38 office alerts.
- Text the same 38 people once more, saying when the new code will
  start working and that their current code works until then. I can
  send that in one run with wording of Chris's choosing.

The 47 codes stay stored. When the system restarts they are not
re-issued or re-texted; the same codes are what the office keys in.

## 4. Current state

| Component | State |
|---|---|
| Database (Supabase "CapRock Gate Codes") | Live. 47 codes: 38 active, 9 suspended. 57 tenant records. Full event log. $10/month. |
| Sync function (Vercel `/api/gate-sync`) | Deployed and PAUSED. Cron removed. Master switch off. |
| Texting (GHL) | Working; proved by the 38 sends. |
| Controller link (Alarm.com) | Not built. Waiting on API access from the Alarm.com dealer. |
| Office alerts | Working, sent to OFFICE_PHONE. If that number is the GHL sending line, they did not arrive; email is available instead (OFFICE_EMAIL). |
| WebSelfStorage | Still generating its own codes at move-in ("Generate Random Code During Move In: Yes"). Should be switched OFF so there is only ever one code per tenant, ours. |

## 5. What is needed to restart

In this order, on a day the office picks:

1. Chris confirms the grace period (30 days?) and the text wording.
2. Switch off "Generate Random Code During Move In" in WebSelfStorage
   (Facility > Gates > Rules), so tenants are not shown a second code.
3. Confirm where office alerts should go: a mobile that can receive
   texts, or the office email.
4. In Vercel, add `GATE_TEXT_ONLY` = one mobile number (Chris's or
   David's). Only that number can be texted while it is set.
5. In Vercel, add `GATE_ENABLED` = `on`, and put the schedule back.
6. Watch one run. Chris reads the message on his phone. If it is right,
   remove `GATE_TEXT_ONLY`. From then on every new move-in, payment
   and move-out is handled automatically.

## 6. What is still manual, and until when

Until Alarm.com API access exists, the office keys each code into the
controller from the alert it receives. Everything else is automatic:
the code, the text, the record, the suspend and revoke decisions, the
alerts. When access arrives, one file in the code changes
(`api/_gate/alarm.js`) and the office stops keying anything in.

Alarm.com does not generally give API access to end customers; it
goes through the installing dealer. That conversation with the dealer
is the critical path for the last mile.

## 7. Decisions for Chris

1. What to do about the 38 tenants who already have a code: key them
   in now, or send a "starts on [date]" text.
2. The grace period before a code is suspended for non-payment
   (default 30 days past paid-through with a balance owing).
3. The wording of the tenant text.
4. Where office alerts go (mobile number or email).
5. Whose phone receives the first message on restart.
6. Chasing the Alarm.com dealer for API access, so the manual step
   can end.

## 8. Costs and limits

- Supabase project: $10/month. Vercel: already paid for (Pro).
  GHL texts: at CapRock's existing SMS rate, roughly one per move-in,
  move-out or payment status change; about 50 on restart day if the
  allow-list is removed the same day, otherwise none, since the 38 are
  already texted.
- It is a poll, not a push: a new tenant gets their code within five
  minutes of appearing in the rentroll, not instantly. The office can
  hand the code over at the counter in the meantime; it shows in the
  database immediately.
- It depends on the rentroll continuing to include phone numbers and
  paid-through dates. Today it does for all 57 contracts.
- Tenant names and phone numbers live in the Supabase database and in
  GHL. Both are access-controlled; nothing reaches the website.

## 9. Where things are

- Code: `api/gate-sync.js` and `api/_gate/` in the CapRock-Self-Storage
  repository. Settings are listed at the top of `gate-sync.js` and in
  `README.md` under "Gate codes".
- Test: `node tools/gate-sync-test.js` proves the rules offline.
- Database: Supabase project `qcwxthyhulyrtqogmyrc`, tables `tenants`,
  `codes`, `events`, `sync_runs`, view `office_list`.
- Function: Vercel project `cap-rock-self-storage`, endpoint
  `/api/gate-sync`.

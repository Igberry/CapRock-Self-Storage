# CapRock Self Storage: website and systems report

Prepared 21 September 2026 by David Igberi, for the meeting with Chris.

## 1. The picture in one paragraph

The website at caprock-storage.com is live, reads its prices and
availability from WebSelfStorage every few minutes, and now takes
rental and reservation requests on its own pages instead of sending
people to uhaul.com. Around it, four automatic processes keep GHL in
step with WebSelfStorage: every tenant becomes a CRM contact, the
voice agent knows what is free, requests from the site land in the
CRM, and gate codes are issued and texted (that one is paused pending
the controller). Everything below runs on one serverless project on
Vercel, one Supabase database, and the GHL account; the website
itself is pasted into GHL page blocks.

## 2. How the pieces connect

```
 WebSelfStorage (U-Haul)                       GHL (CRM, texting, voice agent)
   prices, availability, rentroll                 contacts, custom values, SMS
          │                                              ▲
          │ read every 5 to 15 min                       │ written every 15 min
          ▼                                              │
 ┌──────────────────────────── Vercel ─────────────────────────────┐
 │  /api/wss             prices and availability for the website   │
 │  /api/request         Rent Now / Reserve form handler           │
 │  /api/ghl-availability availability into GHL Custom Values      │
 │  /api/ghl-tenants     every tenant into GHL contacts            │
 │  /api/gate-sync       gate codes (paused)                       │
 └───────────────┬──────────────────────────────┬──────────────────┘
                 │                              │
                 ▼                              ▼
     caprock-storage.com (GHL pages)     Supabase (gate codes, tenants, log)
```

The website never talks to WebSelfStorage directly; it asks the
Vercel proxy, which holds the API key and strips anything a public
page should not see (unit numbers, occupancy, tenant data). Every
automatic process is a small function on the same Vercel project,
each with its own on/off switch in the environment settings, so any
one of them can be paused without touching the others.

## 3. The website

**What it is.** Fourteen pages of hand-written HTML, CSS and
JavaScript, pasted into GHL Custom Code elements, with a shared header
and footer as GHL Global Sections. The header carries the shared code
every page uses: brand colours, the WebSelfStorage helper, the unit
details panel, the request form, the price lock. That is why most
changes are "repaste the header" rather than fourteen pages.

**Pages.** Home, Our Location (the unit list), Size Guide, Storage
Calculator, Storage Tips, Vehicle / Student / Military storage, Help
Center, About, Contact, Waiting List, Terms of Use, Privacy Policy.

**Live data.** The location page, size guide, calculator, home page
and terms all read the same feed through the proxy: every size with a
unit free, its rate, how many are left, and the facility's hours and
promotions. A change in WebSelfStorage reaches the site within about
fifteen minutes. Sizes the feed leaves out (which now means full) are
shown as full with a waiting list button rather than disappearing.

**On each unit.** Size, height, square footage, a cutaway drawing per
size, the live rate, a "12-month price lock" badge, "Only N left" in
red at three or fewer, the current promotions, a details panel, and
Rent Now / Reserve or Join the waiting list.

**Photography.** Thirteen pictures of the property taken on
12 September, plus the enhanced versions Chris supplied, replace the
single photo the site had. New hero, an editorial spread on the home
page, pictures on the location, about, contact and audience pages.

**Also done since launch.** Terms of Use and Privacy Policy pages;
legal entity (Wasatch Home Buyers Inc) on the terms and footer; the
payment portal and My Account links pointed at U-Haul's real tenant
portal and account pages; SEO titles and descriptions for every page;
the flash of unstyled content on every page load fixed; the proxy
hardened against cache-busting; Facebook linked and the dead social
icons removed; address and hours in the footer and on Contact.

## 4. Rent Now and Reserve, on our site

**The problem.** U-Haul's online move-in has a failing ID and selfie
verification step. Customers could not get through it. Both buttons
used to send people there.

**What happens now.** Either button opens a form on our page: the
unit, name, mobile, email, move-in date, a note, a consent box. On
submit, the Vercel endpoint creates the customer in GHL (tagged
rent-request or reserve-request, with the unit and date on the
record), alerts the office by text or email, and texts the customer a
confirmation if they consented. The office completes the rental in
WebSelfStorage and takes payment there or at the counter.

**Why the office is still in the loop.** WebSelfStorage's reservation
and move-in API endpoints require the customer's card number itself
(confirmed 21 September: CreditCard, ExpirationMMYY, CSC). This site
does not handle card numbers. The full self-service version ("Option
B") puts a PCI-certified card vault between our form and U-Haul's
API, so the card never touches our code; it needs a vault account in
CapRock's name and a test environment from U-Haul. Everything built
today stays as it is when that arrives.

**Status.** Built and tested; switched on with one setting.

## 5. Availability into GHL, for the voice agent

**What it does.** Every fifteen minutes, the same feed the website
reads is written into GHL Custom Values: one spoken paragraph
("CapRock has 10 unit sizes available: 5 by 5 temperature controlled
at $45 a month, 29 available; ..."), one value per size code with the
count, rate, type and unit numbers, and a list of sizes that are full.

**How the agent uses it.** The agent's prompt merges the summary
value, so on every call it reads whatever the last sync wrote. The
phone and the website cannot disagree, because they read the same
feed.

**Status.** Live and running.

## 6. Every tenant into GHL

**The problem.** Tenants who sign up through uhaul.com existed only in
WebSelfStorage; the CRM never heard about them.

**What it does.** Every fifteen minutes the rentroll is read and each
current tenant is created or updated as a GHL contact: name, phone,
postal address, a "tenant" tag, and custom fields for unit numbers,
move-in date, paid-through date, balance owed, status, contract ids
and gate code. Someone who moves out is retagged "former-tenant". One
person with three units is one contact. Nothing is sent to anyone;
what the office does with the tenant tag (a welcome text, a review
request) is a GHL workflow for them to build.

**Status.** Built and tested; switched on with one setting and two
added token scopes.

## 7. Gate codes

**The problem.** WebSelfStorage can push gate codes only to the
controllers on its list. CapRock's are not on it, and U-Haul
confirmed in writing: no Alarm.com integration, no API for codes, no
file export, none planned.

**What was built.** Our own: a sync reads the rentroll, issues one
four-digit code per person into Supabase, texts it to the tenant,
suspends it when more than 30 days behind with a balance, reinstates
on payment, revokes at move-out, and hands every change to a
controller adapter. The adapter is a stub until Alarm.com API access
exists; meanwhile the office is alerted what to key in.

**What happened.** On 16 September the first live run sent 38 tenants
their code two steps ahead of the plan. Codes exist for all 47 people
(38 active, 9 suspended for arrears). Nothing has been sent since.

**Status.** Paused: schedule removed, master switch off. Restart is a
deliberate three-step act once the controller path is decided.
Decision needed: key the 38 codes into the current controller, or
text those tenants a "starts on" date.

## 8. The 12-month price lock

CapRock's own promise, stated once in the header and shown wherever a
price is: a badge under each rate, a cell in the details panel, a
feature card on the home page, a Help Center answer and a Terms of Use
clause. Switch it off in one place and every mention disappears. This
is not U-Haul's programme, which covers U-Haul-owned stores only; the
terms are marked for Chris to confirm and must appear in the Rental
Agreement.

## 9. Open with U-Haul

- ID verification failing on online move-ins (email sent, awaiting
  reply).
- Whether a test environment exists for the move-in API (needed for
  Option B).
- The feed's vacancy count is one less than WebSelfStorage's screen
  for some sizes (20 x 40 shows 2, feed says 1); the 20 x 30 has one
  vacant unit and does not appear at all.
- The promotions the feed returns ("1 MONTH FREE") differ from the
  ones uhaul.com shows; the raw location response would settle
  whether they are a separate field.

## 10. Decisions for Chris

1. Gate codes: key in the 38, or text a start date; and the
   controller path (Alarm.com dealer API, or a supported controller).
2. Price lock terms, and putting them in the Rental Agreement.
3. Where office alerts go (a mobile that can receive texts, or email).
4. Option B for Rent Now: a card vault account, yes or no.
5. Switch on the tenant sync and the request form (both ready).
6. A welcome workflow on the "tenant" tag, if wanted.

## 11. Costs

Supabase $10/month. Vercel and GHL as already paid for. Texts at
CapRock's existing SMS rate. Option B would add a card vault (from
free at CapRock's volume to a few hundred a month depending on
provider).

## 12. Where everything lives

Repository CapRock-Self-Storage on GitHub (UtahREIA), which Vercel
deploys from. Pages in pages/, header and footer in global-sections/,
functions in api/, tooling in tools/, this and the gate-code document
in docs/. Every process is described at the top of its own file.

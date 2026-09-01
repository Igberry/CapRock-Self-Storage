# CapRock Self Storage — Website Source

Custom code for the CapRock Self Storage website, built for GoHighLevel's
Custom Code element. Modeled on the layout of
[sroa.com's location page](https://www.sroa.com/find-storage/texas/lubbock/5839-49th-street)
for the same physical facility.

GHL sub-account: 14Forty CRM.

## Folder structure

```
global-sections/
  header.html                     Site-wide header/nav. Save as a GHL Global Section.
  footer.html                     Site-wide footer + scroll-to-top. Save as a second Global Section.
pages/
  home.html                       Home page: hero, trust strip, facilities, steps, features.  /
  find-storage.html               Location directory / search page.        /find-storage
  size-guide.html                 Unit size reference page.                /size-guide
  help-center.html                Help topic hub with search.              /help-center
  storage-calculator.html         Interactive size recommender.            /storage-calculator
  storage-tips.html               Packing / storage advice list.           /storage-tips
  vehicle-storage.html            Vehicle storage landing page.            /vehicle-storage
  student-storage.html            Student storage landing page.            /student-storage
  military-storage.html           Military storage landing page.           /military-storage
  about-caprock.html              Company about page (has open placeholder).  /about-caprock
  careers.html                    Careers page, empty-state openings.      /careers
  contact-us.html                 Contact page with a form (see note below). /contact-us
  lubbock-5839-49th-street.html   The Lubbock location page body (sub-nav + info card + section stubs).
```

The path column is a suggestion, matches the links already wired up in
`header.html`. Set each page's actual path in GHL to match, or update the
header's links if different paths are used.

## How this fits together in GHL

### What to paste, and what never to paste

Paste from **`pages/`** and **`global-sections/`**. Never paste anything
from `preview/`.

The preview files are a local dev convenience and are actively wrong for
production. Each one is a full HTML document (`<!DOCTYPE>`, `<head>`,
`<body>`), which is not valid inside a Custom Code element, and the build
adds two rewrites that would break the live site:

- a **navigation shim** that rewrites `/size-guide` to `size-guide.html`
  so links work on a static dev server. On the real site this breaks
  every link on the page.
- a **keyless Google map**, which drops the real Maps Embed API key.

### Header and footer: two Global Sections, not copies per page

You *can* paste header + body + footer into one Custom Code block per
page. Nothing technically breaks. Don't: changing the phone number, a nav
item or a footer link then means editing thirteen files and re-pasting
thirteen pages, and any page added later has to remember to include both.

The split exists for that reason:

1. This must be a GHL **Website**, not a Funnel, so pages get shared
   navigation and Global Sections.
2. **Build the header once, then save it as a Global Section.** On any
   one page: add a Section, put a Custom Code / HTML element inside it,
   paste `global-sections/header.html`, then select that section and
   choose **Save Section**. In the save modal pick the type **Global**
   and name it "Site Header".

   Pick **Global**, not Universal. The three saved-section types differ
   in sync scope: *Global* syncs within this website only, *Universal*
   syncs account-wide across every funnel and site in the sub-account,
   and *Template* is a static copy that never syncs. Since 14Forty CRM
   may hold other assets, account-wide is broader than wanted.
   **The type cannot be changed after saving** — switching means cloning
   the section and re-saving it — so choose correctly the first time.
3. **Add it to every other page** with Add Section, picking the saved
   "Site Header". Edit that section once afterwards and the change
   propagates to every page using it.
4. Repeat with `global-sections/footer.html` as a second Global Section,
   "Site Footer", at the bottom of every page. It also carries the
   floating scroll-to-top button.
5. For each page: create it in GHL, set its slug (table below), add the
   header Global Section, add a Custom Code element, paste the matching
   file from `pages/`, then add the footer Global Section.

If the header or footer looks blank in the editor canvas, check Preview
before worrying: builders commonly do not execute custom code inside the
editing surface.

The header must be present for the rest to look right: it owns the
`:root` brand tokens and publishes the live header height. Every page
also carries literal fallbacks, so a page still renders correctly if it
is ever previewed on its own.

### Domain and page URLs

**You do not need the domain first, and you never put full URLs in the
HTML.** Every internal link is root-relative (`/size-guide`), so it
resolves against whatever host is serving the page: GHL's temporary
domain while you build, the real domain later. Connecting the domain
changes nothing in these files.

What does matter is that each GHL page's **slug matches the path the
links already use**:

| GHL page slug | File to paste |
|---|---|
| `caprock-self-service` (the site home page) | `pages/home.html` |
| `find-storage` | `pages/find-storage.html` |
| `size-guide` | `pages/size-guide.html` |
| `help-center` | `pages/help-center.html` |
| `storage-calculator` | `pages/storage-calculator.html` |
| `storage-tips` | `pages/storage-tips.html` |
| `vehicle-storage` | `pages/vehicle-storage.html` |
| `student-storage` | `pages/student-storage.html` |
| `military-storage` | `pages/military-storage.html` |
| `about-caprock` | `pages/about-caprock.html` |
| `careers` | `pages/careers.html` |
| `contact-us` | `pages/contact-us.html` |
| `find-storage/texas/lubbock/5839-49th-street` | `pages/lubbock-5839-49th-street.html` |

**The last row is the one to check first.** It is a nested path, copied
from the SROA reference URL. If GHL will not accept slashes in a page
slug, use a flat one such as `lubbock-5839-49th-street` and update the
three places that reference it:

- `pages/find-storage.html` — the `url` in the `LOCATIONS` array
- `pages/home.html` — the `url` in its `LOCATIONS` array
- `global-sections/footer.html` — the Locations link

### Full-width bands vs GHL's centred row

GHL puts a Custom Code element inside its own row/column, which is
centred with a **max-width**. Left to itself that leaves white gutters
down both sides of anything meant to run edge to edge: the header bar,
the dark hero, every tinted section band, the footer. Setting the
margins to 0 in the builder does not help, because the constraint is the
parent's max-width, not a margin.

Every top-level wrapper therefore breaks out of its parent:

```css
.crss-home {
  width: var(--crss-vw, 100vw);
  max-width: var(--crss-vw, 100vw);
  margin-left: calc(50% - (var(--crss-vw, 100vw) / 2));
  margin-right: calc(50% - (var(--crss-vw, 100vw) / 2));
}
```

`--crss-vw` is the viewport width **excluding** the scrollbar, published
by the header script on load and resize. `100vw` is only the fallback,
because it *includes* the scrollbar and would overflow by its width,
adding a horizontal scrollbar on desktop.

This is safe everywhere. When the parent is already full width, `50%`
of the parent equals half the viewport and the margins compute to zero,
so the local previews are unchanged.

Content stays centred regardless: each wrapper's inner container keeps
its own `max-width` and `margin: 0 auto`. Only the background extends.

Worth also setting the section to full width in the builder if the
option is there — the two do not conflict, and it keeps the editor
canvas honest about what the page will look like.

### Links that still go nowhere

Sixteen `href="#"` links need real destinations or removal before launch:

- **`header.html` (3)** — My Account, Pay Your Bill, and the mobile My
  Account. These usually point at the tenant portal.
- **`footer.html` (6)** — four social profiles, Terms of Service,
  Privacy Policy.
- **`help-center.html` (6)** — the six topic cards. No help articles
  exist yet.
- **`lubbock-5839-49th-street.html` (1)** — "View Location Details".

## Brand colors ("Option 4, Southwest Contemporary")

| Color | Hex | Token | Use |
|---|---|---|---|
| Warm Cream | `#F1E3CC` | `--crss-cream` | Accent: CTA headline text, hover tints |
| Terra Cotta | `#A44A23` | `--crss-terracotta` | Buttons, rules, active states, icons |
| Terra Cotta Dark | `#863B1A` | `--crss-terracotta-dark` | Hover state for terracotta |
| Warm Taupe | `#7F6C5D` | `--crss-taupe` | Micro-labels, eyebrows, placeholder art |
| Deep Charcoal | `#292724` | `--crss-charcoal` | Headings, sub-nav, CTA panels |
| Clean White | `#FFFFFF` | `--crss-white` | Cards, header |
| Bone | `#FAF7F1` | `--crss-bone` | The page field, every page background |
| Sand | `#EFE7DA` | `--crss-sand` | Inset panels: empty states, stubs |
| Soft Ink | `#5F564C` | `--crss-ink-soft` | Body prose (7.2:1 on white) |

Cream is an **accent**, not the page background. Pages sit on Bone, with
white cards and hairline borders on top of it.

Headings are Fraunces at weight 500 with `font-optical-sizing: auto`;
body copy is Work Sans 16px/1.7. Labels, buttons, breadcrumbs and
sub-nav tabs are uppercase micro-type with wide letter-spacing. Cards
use a 6px radius. See PROJECT_SUMMARY.md, "Visual system", for the full
rationale.

## Still open / placeholders

Search each file for the word `PLACEHOLDER` for the exact spots.

- Real phone number (dummy number used across the header, Lubbock page,
  and contact page)
- Real logo (currently a styled text wordmark)
- Real email address on the contact page
- Office address note on the Lubbock page
- Facility photo (Lubbock info card and Find Storage card, currently a textured placeholder panel)
- Fonts: Fraunces + Work Sans is a starting pairing, swap for CapRock's
  real brand fonts once chosen
- ~~Google Map embed key~~ done: the Lubbock map uses the Maps Embed
  API. The key is public by design (it ships in page source); it is the
  HTTP referrer restriction in Google Cloud that protects it.
- **Contact form**: `contact-us.html` has a styled `<form>` that only
  shows a confirmation message, it doesn't submit anywhere. Replace it
  with GHL's native Forms element before launch, that's what actually
  wires submissions into the CRM.
- About CapRock's "Our Story" section is a marked placeholder, no real
  company history was available to write from
- Careers has no real openings or "why work here" copy yet
- Vehicle/Student/Military storage pages avoid stating specific
  discounts or exact parking types since those weren't confirmed
- `find-storage.html` hardcodes locations in a small JS array near the
  bottom of the file, move that to a real data source once there are
  more than a handful of facilities
- On the Lubbock page, Features, Storage Faqs and City Information are
  built. Still open: the Reviews section (needs a data source), and the
  live Units/pricing list (waiting on the WebSelfStorage API key, which
  needs a server-side proxy, it cannot sit in GHL Custom Code). The
  built sections list their own unconfirmed items on the page: hours,
  lock policy, payments, insurance, Noke locks, supplies, promotions.

## Reference

**The Lubbock address in this repo is NOT CapRock's facility.**
5839 49th Street, Lubbock, TX 79424 was taken from the SROA reference
page and is that company's property. CapRock has confirmed no facility
yet. It stands in as scaffolding so the location-page template and the
card grids have something to render. **Do not publish any page carrying
it** — see the launch blocker in PROJECT_SUMMARY.md.

Layout reference: https://www.sroa.com/find-storage/texas/lubbock/5839-49th-street

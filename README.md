# CapRock Self Storage — Website Source

Custom code for the CapRock Self Storage website, built for GoHighLevel's
Custom Code element. Modeled on the layout of
[sroa.com's location page](https://www.sroa.com/find-storage/texas/lubbock/5839-49th-street)
for the same physical facility.

GHL sub-account: 14Forty CRM.

## Folder structure

```
$1  footer.html                     Site-wide footer + scroll-to-top. Save as a second Global Section.
$1  home.html                       Home page: hero, trust strip, facilities, steps, features.  /
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

1. This needs to be a GHL **Website** (not a Funnel), so pages get shared
   navigation and Global Sections.
$1   Do the same with `global-sections/footer.html` as a second Global
   Section ("Site Footer"), added to the bottom of every page. It also
   carries the floating scroll-to-top button.
3. Everything in `pages/` is page-specific body content. Create the page
   in GHL (name + path), add the header Global Section, then add a
   Custom Code element below it and paste in the matching file.
4. Files in `pages/` share colors, fonts, and header-height variables
   with `header.html` through CSS custom properties on `:root`, they
   don't redeclare them. `header.html` needs to be on the page for
   the other files to look right.

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

Facility: 5839 49th Street, Lubbock, TX 79424

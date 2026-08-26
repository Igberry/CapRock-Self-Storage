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
pages/
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
2. Paste `global-sections/header.html` into a Custom Code element on any
   one page, then save that section as a **Global Section** named
   something like "Site Header". Add that Global Section to the top of
   every page.
3. Everything in `pages/` is page-specific body content. Create the page
   in GHL (name + path), add the header Global Section, then add a
   Custom Code element below it and paste in the matching file.
4. Files in `pages/` share colors, fonts, and header-height variables
   with `header.html` through CSS custom properties on `:root`, they
   don't redeclare them. `header.html` needs to be on the page for
   the other files to look right.

## Brand colors ("Option 4, Southwest Contemporary")

| Color | Hex | Use |
|---|---|---|
| Warm Cream | `#F1E3CC` | Backgrounds, sections |
| Terra Cotta | `#A44A23` | Buttons, highlights, icons |
| Warm Taupe | `#7F6C5D` | Secondary accents |
| Deep Charcoal | `#292724` | Text, footer, navigation |
| Clean White | `#FFFFFF` | Contrast |

## Still open / placeholders

Search each file for the word `PLACEHOLDER` for the exact spots.

- Real phone number (dummy number used across the header, Lubbock page,
  and contact page)
- Real logo (currently a styled text wordmark)
- Real email address on the contact page
- Office address note on the Lubbock page
- Facility photo (Lubbock info card and Find Storage card)
- Fonts: Fraunces + Work Sans is a starting pairing, swap for CapRock's
  real brand fonts once chosen
- Google Map embed works without a key for now, swap in a Maps Embed
  API key for production
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
- On the Lubbock page: Reviews section, Noke Smart Access FAQ, Unit
  Features, City Information, and the live Units/pricing list are all
  still stubs, the last one is waiting on the WebSelfStorage API key

## Reference

Facility: 5839 49th Street, Lubbock, TX 79424

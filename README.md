# CapRock Self Storage — Website Source

Custom code for the CapRock Self Storage website, built for GoHighLevel's
Custom Code element. Modeled on the layout of
[sroa.com's location page](https://www.sroa.com/find-storage/texas/lubbock/5839-49th-street)
for the same physical facility.

GHL sub-account: 14Forty CRM.

## Folder structure

```
global-sections/
  header.html        Site-wide header/nav. Save as a GHL Global Section.
pages/
  find-storage.html               Location directory / search page.
  size-guide.html                 Unit size reference page.
  lubbock-5839-49th-street.html   The Lubbock location page body (sub-nav + info card + section stubs).
```

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

Search each file for the word `PLACEHOLDER` for the exact spots. As of
this commit:

- Real phone number (currently a dummy number in the header and the
  Lubbock page's info card)
- Real logo (currently a styled text wordmark)
- Office address note on the Lubbock page
- Facility photo (both the Lubbock info card and the Find Storage card)
- Fonts: Fraunces + Work Sans is a starting pairing, swap for CapRock's
  real brand fonts once chosen
- Google Map embed works without a key for now, swap in a Maps Embed
  API key for production
- Reviews section, Noke Smart Access FAQ, Unit Features, City
  Information, and the live Units/pricing list are all still stubs on
  the Lubbock page, the last one is waiting on the WebSelfStorage API
  key
- `find-storage.html` hardcodes locations in a small JS array near the
  bottom of the file, move that to a real data source once there are
  more than a handful of facilities

## Reference

Facility: 5839 49th Street, Lubbock, TX 79424

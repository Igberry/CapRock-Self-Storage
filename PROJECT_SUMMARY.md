# CapRock Self Storage Website — Project Summary

Full handoff context for continuing this build (e.g. in Claude Code).
This file exists because the conversation that produced this repo isn't
visible from here, everything relevant is written down below.

## What this is

A website for CapRock Self Storage, being built inside **GoHighLevel
(GHL)**, GHL sub-account "14Forty CRM", using GHL's **Custom Code**
element (raw HTML/CSS/JS pasted into the page builder). It is modeled on
the layout of a competitor's location page:
https://www.sroa.com/find-storage/texas/lubbock/5839-49th-street
(Storage Rentals of America, same physical facility).

The facility being launched first: **5839 49th Street, Lubbock, TX
79424**. That address is real, pulled directly from the reference site.
Everything else facility-specific (phone, office address, photo) is a
placeholder, see below.

## Why the code looks the way it does (read this before refactoring)

This is not a normal multi-page web app with a build step. Each file in
`pages/` is meant to be pasted, as-is, into one GHL page's Custom Code
element. There is no bundler, no shared `.css`/`.js` file GHL can load,
so:

- Every page file is **self-contained**: its own `<style>` and
  `<script>` tags inline in the same file.
- Shared brand colors, fonts, and the live sticky-header-height are
  defined once, in `global-sections/header.html`, on `:root` (not
  scoped to a wrapper div), so that any other page's Custom Code block
  sitting next to it in the real GHL DOM can use `var(--crss-*)` and
  get the same values.
- Every `var(--crss-*)` reference in `pages/*.html` also carries a
  **fallback value** (e.g. `var(--crss-terracotta, #A44A23)`), so each
  page still renders correctly with the right colors even when opened
  on its own, without `header.html` present. This was fixed after an
  early version shipped without fallbacks and rendered unstyled when
  previewed standalone, keep this pattern for any new page.
- Class names are prefixed `crss-` (CapRock Self Storage) throughout,
  specifically to avoid colliding with whatever else GHL's page builder
  puts on the page. Keep that prefix on anything new.

If continuing this in Claude Code and adding a build step, bundler, or
shared stylesheet, that's fine for local development, but the **shippable
output still needs to be self-contained per-page HTML** to paste into
GHL, since GHL Custom Code doesn't support linked local stylesheets or
a module system.

## GHL platform facts learned during this build (still true, verify if
old)

- GHL has two separate page-building tools: **Funnels** (linear
  sequences) and **Websites** (multi-page, with real nav and shared
  Global Sections). This project needs to be a **Website**.
- **Global Sections**: a section (e.g. the header) can be saved once
  and reused across every page; editing the saved section updates every
  page using it. This is how `global-sections/header.html` should be
  deployed, saved as one Global Section, added to every page.
- GHL's public API is confirmed **read-only for funnel/website page
  content**, there is no write endpoint to create pages or place page
  elements programmatically (confirmed via GHL's own product team on
  their public roadmap board, as of this build). Pages have to be
  created and have Custom Code pasted in through the GHL UI by a person,
  an AI agent with GHL API/MCP access cannot do this step.
- GHL has a native "Funnel & Website AI" feature (in Labs, may need an
  admin to enable it) that generates page structure from a prompt/URL/
  image inside the builder itself. Separate from this repo's approach,
  worth knowing about but not used here.

## Folder structure

```
README.md                         Setup instructions, brand colors, placeholder list
PROJECT_SUMMARY.md                 This file
global-sections/
  header.html                      Site-wide header/nav + shared :root tokens. → GHL Global Section
pages/                              One file per page, paste into a Custom Code element
  find-storage.html                 /find-storage        Location directory, client-side search over a hardcoded JS array (1 location so far)
  size-guide.html                   /size-guide           9 standard unit sizes (2x5 through 10x30) with scaled visual diagrams
  help-center.html                  /help-center          Help topic hub, 6 categories, client-side search, links to nowhere yet (no articles built)
  storage-calculator.html           /storage-calculator   Interactive: click a description of what you're storing, get a recommended size
  storage-tips.html                 /storage-tips         8 generic packing/storage tips
  vehicle-storage.html              /vehicle-storage      Audience landing page, generic, no specific parking types confirmed
  student-storage.html              /student-storage      Audience landing page, generic
  military-storage.html             /military-storage     Audience landing page, no discount claimed (unconfirmed)
  about-caprock.html                /about-caprock        "Our Story" is an explicit placeholder, no real company history was available
  careers.html                      /careers              Empty-state "no openings" section, no real openings provided
  contact-us.html                   /contact-us           Has a styled but non-functional <form>, see "Known issues" below
  lubbock-5839-49th-street.html     (location page)        Sub-nav (Units/Features/Reviews/Storage Faqs/City Information anchors) + info card + 5 section stubs
preview/
  *.html                            Complete standalone HTML documents (header + page body concatenated) for opening directly in a browser. Not for GHL, dev use only.
```

## Known issues / things to fix or finish

1. **Contact form doesn't submit anywhere.** `pages/contact-us.html` has
   a `<form>` with a JS handler that only shows a confirmation message
   client-side. Before launch, delete that form and use GHL's native
   Forms element instead, that's what actually wires a submission into
   the CRM. Custom code has no backend to send to.
2. **`find-storage.html` hardcodes locations** in a small JS array
   (`LOCATIONS`) near the bottom of the file. Fine for one facility,
   move to a real data source (Supabase, or a GHL custom object) once
   there are more than a handful.
3. **Nav paths are assumed, not confirmed in GHL.** `header.html`'s
   links (and the breadcrumbs in every page) point to the paths in the
   table above. If pages get different paths when actually created in
   GHL, update the links to match.
4. The Lubbock page's five sections (Units, Features, Reviews, Storage
   Faqs, City Information) are still stub containers with placeholder
   text, not built out. Units specifically is blocked on the
   WebSelfStorage API key (affiliate access request was sent, response
   still pending as of this build). Storage Faqs' "Noke Smart Access"
   sub-section needs confirming whether this facility actually uses
   Noke locks before writing it.

## Placeholders needing real data (search each file for `PLACEHOLDER`)

- Real phone number, used across `header.html`, the Lubbock page, and
  `contact-us.html` (currently a dummy number)
- Real logo (currently a styled text wordmark, "CapRock / SELF STORAGE")
- Real email address on `contact-us.html`
- Office address note on the Lubbock page
- Facility photo (Lubbock info card and the Find Storage card both use
  a placeholder gradient box)
- Fonts: **Fraunces** (headings) + **Work Sans** (body) is a starting
  pairing chosen for this build, loaded via Google Fonts `@import` in
  `header.html`. Swap for CapRock's real brand fonts once chosen.
- Google Map embed on the Lubbock page works without an API key for
  now (`?output=embed` URL pattern), swap in a proper Maps Embed API
  key for production
- About CapRock's company story, Careers openings and "why work here"
  copy: intentionally left as marked placeholders, no real facts were
  available to write from, don't invent specifics here

## Brand colors ("Option 4, Southwest Contemporary")

| Token | Hex | Use |
|---|---|---|
| `--crss-cream` | `#F1E3CC` | Backgrounds, sections |
| `--crss-terracotta` | `#A44A23` | Buttons, highlights, icons |
| `--crss-terracotta-dark` | `#863B1A` | Hover state for terracotta |
| `--crss-taupe` | `#7F6C5D` | Secondary accents, muted text |
| `--crss-charcoal` | `#292724` | Text, footer, navigation |
| `--crss-white` | `#FFFFFF` | Contrast, cards |

## Suggested next steps

1. Verify the fix in "Why the code looks the way it does" actually
   resolved the standalone-rendering issue, open a file from `preview/`
   in a browser and confirm colors/fonts show up correctly.
2. Fill in the confirmed placeholders (phone, logo, fonts) once CapRock
   provides them, they're used in multiple files each, search and
   replace carefully.
3. Build out the Lubbock page's 5 stub sections, in this order: Unit
   Features (no dependency), Storage Faqs General group (no
   dependency), City Information (no dependency, content pattern
   already modeled on the SROA reference for Lubbock), Reviews (needs a
   data source decision), Units (blocked on the WebSelfStorage API key).
4. Once more than one facility exists, revisit `find-storage.html`'s
   hardcoded array and the Lubbock page's naming pattern
   (`lubbock-5839-49th-street.html`) as the template for additional
   location pages.

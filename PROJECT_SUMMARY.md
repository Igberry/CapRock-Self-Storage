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

The facility: **CapRock Self-Storage, 2213 N Quaker, Lubbock, TX**.

> **History worth knowing.** Until this address was confirmed, the site
> was built around 5839 49th Street, Lubbock — an address copied from
> the SROA reference page, which is *their* property, not CapRock's. It
> reached a location page, both card grids, the footer and a live map
> before anyone noticed. It has all been replaced. If a second facility
> is ever added from a competitor's page again, check whose building it
> actually is first.

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
- **Every wrapper-level reset is written inside `:where()`**, and must
  stay that way:

  ```css
  .crss-x :where(h1, h2, p) { margin: 0; padding: 0 }
  .crss-x :where(a)         { text-decoration: none; color: inherit }
  ```

  Written plainly as `.crss-x h1` or `.crss-x a`, a reset scores
  (0,1,1), which beats a utility class like `.crss-x-title` or
  `.crss-x-cta-btn` at (0,1,0) **regardless of source order**. This bit
  the project twice:

  1. Every `margin-bottom` set on a bare class was dead, so titles,
     ledes and section headings rendered with no spacing at all.
  2. Every anchor-based button inherited the surrounding text colour
     instead of white, so terracotta buttons rendered with charcoal
     text at roughly 2.5:1 contrast.

  `:where()` contributes zero specificity, so the reset drops to
  (0,1,0) and the component rules below it win on order, as intended.
  The check script fails the build if either reset loses its
  `:where()`.

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
  footer.html                      Site-wide footer + scroll-to-top. → a SECOND GHL Global Section
pages/                              One file per page, paste into a Custom Code element
  home.html                         /                     Home. Hero + search, trust strip, facility cards (x2), 3 steps, long-form copy, features, testimonials
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
  lubbock-2213-n-quaker.html        (location page)        Sub-nav (Units/Features/Reviews/Storage Faqs/City Information anchors) + info card + 5 section stubs
preview/
  *.html                            Complete standalone HTML documents (header + page body concatenated) for opening directly in a browser. Not for GHL, dev use only.
```

## Known issues / things to fix or finish

0. **Still not publishable, but no longer for want of a facility.**
   2213 N Quaker is confirmed and in place. What is left on the
   location page:
   - the **phone number** is still the shared dummy, across the header,
     footer, contact page and this page. A live page with a wrong
     number is worse than no page.
   - the **ZIP code** for the street address
   - the **office address note**
   - the **facility photo** in the info card

1. **Contact form doesn't submit anywhere.** `pages/contact-us.html` has
   a `<form>` with a JS handler that only shows a confirmation message
   client-side. Before launch, delete that form and use GHL's native
   Forms element instead, that's what actually wires a submission into
   the CRM. Custom code has no backend to send to.
2. **`find-storage.html` hardcodes locations** in a small JS array
   (`LOCATIONS`) near the bottom of the file. Fine for one facility,
   move to a real data source (Supabase, or a GHL custom object) once
   there are more than a handful.
   **This array now exists in two files**: `find-storage.html` and
   `home.html`. They must be kept in sync by hand until both read from
   a real data source. Adding a facility means editing both.
3. **Nav paths are assumed, not confirmed in GHL.** `header.html`'s
   links (and the breadcrumbs in every page) point to the paths in the
   table above. If pages get different paths when actually created in
   GHL, update the links to match.
4. The Lubbock page: **Features, Storage Faqs and City Information are
   built**. Two sections remain stubs, for different reasons:
   - **Units** is blocked on the WebSelfStorage API key, which had not
     been activated as of this writing. That key must never go into GHL
     Custom Code, which is client-side and readable via View Source; it
     needs a server-side proxy (Vercel function or Supabase Edge
     Function) holding the key in an environment variable.
   - **Reviews** is waiting on a data-source decision. Nothing is
     invented there, for the same reason the home page testimonials are
     empty scaffolding.

   Within the built sections, several things are deliberately listed as
   unconfirmed rather than answered: gate and office hours, lock policy,
   payment methods, insurance requirements, whether the property uses
   Noke smart locks, on-site supplies, and any promotion. Wrong answers
   about hours or locks send someone to a locked gate, so they stay
   open until CapRock confirms.

## Placeholders needing real data (search each file for `PLACEHOLDER`)

- Real phone number, used across `header.html`, the Lubbock page, and
  `contact-us.html` (currently a dummy number)
- Real logo (currently a styled text wordmark, "CapRock / SELF STORAGE")
- Real email address on `contact-us.html`
- Office address note on the Lubbock page
- Facility photo (Lubbock info card and the Find Storage card both use
  a placeholder textured panel)
- Fonts: **Fraunces** (headings) + **Work Sans** (body) is a starting
  pairing chosen for this build, loaded via Google Fonts `@import` in
  `header.html`. Swap for CapRock's real brand fonts once chosen.
- ~~Google Map embed key~~ done: the Lubbock map calls the official Maps
  Embed API (`/maps/embed/v1/place`) instead of the undocumented
  `?output=embed` pattern. The key is public by design, it ships in the
  page source; the HTTP referrer restriction in Google Cloud is what
  protects it.

  **Two things to check in Google Cloud before launch.** The key is
  shared with CapRock's other websites, so it already works *there*, but
  that does not carry over on its own:

  1. **Add the CapRock domain to the key's HTTP referrer allowlist.**
     The allowlist is per domain. A key working on other sites means
     those domains are listed, not this one. Add the live domain and
     whatever domain GHL serves from while building (often
     `*.msgsndr.com`). Symptom if missed: "This IP, site or mobile
     application is not authorized to use this API key."
  2. **Confirm Maps Embed API is on the key's allowed-APIs list.** The
     other sites use the Maps *JavaScript* API (`maps/api/js`), which is
     a different API. If the key is restricted to JS + Places, the
     iframe fails even from an allowed domain. The referrer check fires
     first, so this can stay hidden until the domain is allowed.

  Local previews sidestep both: the preview build rewrites the map to
  the keyless form, so localhost never needs to be on the allowlist.
  Adding localhost to a production key is worth avoiding, referrers are
  spoofable and it widens who can bill the account.
- About CapRock's company story, Careers openings and "why work here"
  copy: intentionally left as marked placeholders, no real facts were
  available to write from, don't invent specifics here

On the home page and the footer specifically:

- Hero promotional line. The SROA reference runs "UP TO 50% OFF" there.
  Nothing is claimed until CapRock confirms a real offer.
- Hero background photography
- Trust badges: three placeholder circles. Only real, earned
  accreditations belong here. The BBB / Shopper Approved /
  Reputation.com badges in the SROA spec are that company's own
  accreditations and third-party trademarks, they must not be
  reproduced for CapRock.
- Testimonials: four empty scaffold cards. The SROA spec supplies four
  real, named reviews. Attributing those to CapRock would be a
  fabricated review, so the layout is built and the content waits on a
  real review source. Star ratings and review counts on the facility
  cards are left out for the same reason.
- Social profile URLs in the footer, or delete that column
- Footer legal disclaimer, and the Terms of Service / Privacy Policy
  pages it links to

## Brand colors ("Option 4, Southwest Contemporary")

Core palette, unchanged. Note that cream is now an *accent* (CTA
headlines, hover tints), not the page background, see the surface
tokens below.

| Token | Hex | Use |
|---|---|---|
| `--crss-cream` | `#F1E3CC` | Accent: CTA headline text, hover tints |
| `--crss-terracotta` | `#A44A23` | Buttons, rules, active states, icons |
| `--crss-terracotta-dark` | `#863B1A` | Hover state for terracotta |
| `--crss-taupe` | `#7F6C5D` | Micro-labels, eyebrows, placeholder art |
| `--crss-charcoal` | `#292724` | Headings, sub-nav bar, CTA panels |
| `--crss-white` | `#FFFFFF` | Cards, header |

### Surface + ink tokens (added in the styling pass)

| Token | Hex | Use |
|---|---|---|
| `--crss-bone` | `#FAF7F1` | The page field, every page background |
| `--crss-sand` | `#EFE7DA` | Inset panels: empty states, stubs, office note |
| `--crss-ink-soft` | `#5F564C` | Body prose. 7.2:1 on white, where taupe is 5.0:1 |
| `--crss-rule` | `rgba(41,39,36,0.09)` | Hairline borders on cards and dividers |
| `--crss-border` | `rgba(41,39,36,0.12)` | Slightly stronger border, form inputs |

## Visual system (the styling pass)

The layout, DOM, and copy of every page are unchanged; only the
`<style>` blocks were rewritten, so this is safe to re-paste over the
existing GHL Custom Code elements without redoing any page structure.

The direction is editorial / classic-modern:

- **Type.** Fraunces is now loaded as a true variable font with
  `font-optical-sizing: auto`, so large headings use the display cut
  rather than a scaled-up text cut. Headings dropped from weight 600 to
  **500** and grew to `clamp(36px, 5.2vw, 52px)` with `-0.02em`
  tracking. Body copy is 16px at 1.7 line-height in `--crss-ink-soft`.
- **Micro-type.** Breadcrumbs, labels, buttons, and sub-nav tabs are
  uppercase at 10.5–12px with 0.11–0.18em letter-spacing.
- **The rule.** Every page title draws a 54×2px terracotta rule beneath
  itself via `::after`, so no markup was needed for it.
- **Cards.** 6px radius (was 12px), hairline border, near-flat at rest,
  lifting 3px with a soft shadow on hover.
- **CTA panels.** The closing CTA on each page is now a charcoal panel
  with a radial terracotta wash. The terracotta button carries a 1px
  cream ring so it separates from the dark ground.
- **Motion.** 0.26–0.3s `cubic-bezier(.4,0,.2,1)` throughout, and every
  page now has a `prefers-reduced-motion` block that disables it.

Two things stayed deliberately plain: the About "Our Story" block and
the Lubbock section stubs keep their dashed borders, because they are
genuinely unfinished and should not read as approved content.

## Responsive tiers

Breakpoints, widest first. **They must stay in descending order inside
each file**: two `max-width` queries that both match at a given width
are equal on specificity, so the later one wins. A wider breakpoint
written after a narrower one silently overrides it.

| Width | What changes |
|---|---|
| `1280` | Header only. Nav spacing tightens and My Account goes icon-only. |
| `1180` | Header folds into the hamburger. |
| `1080` | Home hero search: the text field takes its own row. |
| `960` | Lubbock: sidebar stops being sticky and drops below the content. |
| `900` | Home: steps and testimonials go single column. Footer: 4 columns to 2. |
| `768` | **Tablet tier on every page.** Section padding `64/32/104` drops to `48/26/80`, card interiors tighten, home sections drop from 96px to 72px. |
| `720` | Contact: the info/form grid stacks. Lubbock: sub-nav gains a scroll fade. |
| `700` | Home hero search: everything stacks full width. |
| `560` | Phone tier. Padding to `44/20/72`, remaining grids to one column. |

Before this pass, most pages had **only** the 560px rule and went
straight from desktop rhythm to phone rhythm, with nothing in between.

Two things worth keeping in mind:

- The header needs roughly 1200px to lay out the wordmark, five nav
  items and three utility items at desktop spacing. The nav links are
  `white-space: nowrap` with no shrink floor, so they collide rather
  than reflow. That is why the hamburger now takes over at 1180 rather
  than 960, and why nothing in the utility row is hidden at a width
  where the mobile panel is not yet available to carry it.
- The Lubbock sub-nav scrolls sideways below ~700px by design. Its
  scrollbar is hidden, so the right-edge fade is the only affordance
  telling people there is more to the right. Do not remove one without
  the other.

## Suggested next steps

1. Verify the fix in "Why the code looks the way it does" actually
   resolved the standalone-rendering issue, open a file from `preview/`
   in a browser and confirm colors/fonts show up correctly.
2. Fill in the confirmed placeholders (phone, logo, fonts) once CapRock
   provides them, they're used in multiple files each, search and
   replace carefully.
3. ~~Build out the Lubbock stub sections~~ Features, Storage Faqs and
   City Information are done. What is left there:
   - Get CapRock's real answers to the open questions listed in the
     Storage Faqs panel, and to the three empty Feature groups.
   - Decide a Reviews data source.
   - Stand up the WebSelfStorage proxy once the key is activated, then
     build the Units section against it.
4. Once more than one facility exists, revisit `find-storage.html`'s
   hardcoded array and the Lubbock page's naming pattern
   (`lubbock-2213-n-quaker.html`) as the template for additional
   location pages.

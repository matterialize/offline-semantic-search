---
name: Offline Semantic Search
description: A quiet browser utility for finding and navigating a passage.
colors:
  surface: "#fffaf2"
  ink: "#302923"
  secondary: "#706359"
  line: "#ddd2c5"
  accent: "#975033"
  selected: "#f2e5d7"
  hover: "#f7eee3"
  field-line: "#a38b78"
  text-selection: "#eed4bc"
  surface-dark: "#26211e"
  ink-dark: "#f3e9dd"
  secondary-dark: "#c8b8aa"
  line-dark: "#4b4038"
  accent-dark: "#e9ad88"
  selected-dark: "#413127"
  hover-dark: "#332b25"
  field-line-dark: "#aa8f7c"
  text-selection-dark: "#634531"
  page: "#f8f3eb"
  page-dark: "#201c19"
  accent-hover: "#783c25"
  accent-hover-dark: "#f1c4a8"
  passage-ink: "#302923"
  passage-highlight: "#ffe38a"
  passage-context: "#fff3cc"
  passage-line: "#ac7b13"
  passage-overlay: "rgba(255,207,67,.35)"
  passage-context-overlay: "rgba(255,207,67,.17)"
typography:
  demo-display:
    fontFamily: "Georgia, serif"
    fontSize: "clamp(36px, 6vw, 54px)"
    fontWeight: 400
    lineHeight: "1.1"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
  input:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 400
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  marker: "2px"
  control: "8px"
  panel: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0px"
    height: "44px"
  button-icon-hover:
    backgroundColor: "{colors.hover}"
  button-retry:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  search-field:
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.control}"
    padding: "0px 12px"
  result-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "{spacing.md}"
  result-row-hover:
    backgroundColor: "{colors.hover}"
  result-row-selected:
    backgroundColor: "{colors.selected}"
  result-navigation:
    textColor: "{colors.secondary}"
  searching-status:
    textColor: "{colors.secondary}"
    typography: "{typography.label}"
  floating-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "0px 12px 8px"
    width: "380px"
  passage-context:
    backgroundColor: "{colors.passage-context}"
    textColor: "{colors.passage-ink}"
  passage-highlight:
    backgroundColor: "{colors.passage-highlight}"
    textColor: "{colors.passage-ink}"
---

# Design System: Offline Semantic Search

## Overview

**Creative North Star: "Warm Paper"**

A familiar, compact find panel takes only the space needed to search and navigate a passage. System typography, an ivory paper surface, and restrained rust state colors keep the controls easy to scan. The underlying page remains readable and interactive.

The interface is a small floating utility on desktop and a bottom panel on mobile. Its visual character comes from precise spacing, simple stroke icons, and clear control states. Follow the system light or dark preference automatically; dark mode uses warm charcoal surfaces and peach accents. Decorative imagery, gradients, and technical badges are outside the approved visual language.

**Key Characteristics:**

- Compact controls with generous touch targets.
- System typography and an ivory-and-rust palette with a warm charcoal dark theme.
- Divided result rows with a clear current selection.
- One raised panel over an interactive page.
- Amber passage highlighting that remains visible outside the panel.

This document records the approved Warm Paper system implemented in `src/panel.css`, `src/demo.css`, `src/icon.svg`, `panel.html`, `src/page/panel-host.ts`, and `src/page/highlight.ts`. Theme values, layout, and motion behavior are extracted from the code. Color, type, radius, and spacing values above are normative.

## Colors

Rust supplies the panel's interaction language on warm paper; peach carries it on warm charcoal in dark mode. Amber identifies the matching passage on the page.

### Primary

- **Rust** (`accent`) marks field focus, keyboard focus, the text caret, and the loading stroke. **Peach** (`accent-dark`) performs the same roles in dark mode.
- **Pale parchment** (`selected`) and **deep brown** (`selected-dark`) identify the current result. Hover uses the quieter `hover` or `hover-dark` surface.
- **Selection tan** (`text-selection`, `text-selection-dark`) colors native text selection inside the panel.

### Secondary

- **Passage amber** (`passage-highlight`) identifies the active sentence in the underlying document, with an amber underline (`passage-line`). Sufficiently relevant neighboring sentences use pale amber (`passage-context`) without an underline. The overlay fallback uses `passage-overlay` for the active sentence and `passage-context-overlay` for neighbors. These are functional passage colors, not panel action colors.

### Neutral

| Role | Light token | Dark token |
| --- | --- | --- |
| Panel and resting result surface | `surface` | `surface-dark` |
| Main text and button icons | `ink` | `ink-dark` |
| Status and position count | `secondary` | `secondary-dark` |
| Result dividers and retry-button border | `line` | `line-dark` |
| Search-field border and scrollbar thumb | `field-line` | `field-line-dark` |

The panel and demo swap their corresponding CSS custom properties through `prefers-color-scheme: dark`. The iframe host explicitly supports `color-scheme: light dark`, so an embedding page cannot force the wrong palette. The demo page uses `page` / `page-dark` behind the shared panel surface; its filled action uses the accent with `accent-hover` / `accent-hover-dark` and inverse surface-colored text. Passage highlighting retains its amber palette and fixed warm brown `passage-ink` foreground in both themes. Native search-field affordances retain browser styling.

**The State Color Rule.** Keep hover, current result, and keyboard focus visibly distinct; preserve the amber passage marker as a separate document-level cue.

## Typography

Panel roles use the system sans-serif stack in the frontmatter, without web fonts or uppercase labels. The demo reading page retains its existing Georgia serif heading (36–54px responsive size, 1.1 line height, normal weight); this editorial treatment does not apply to the compact panel.

- **Title:** the semibold panel heading, `title`.
- **Body:** result sentences, `body`; clamp previews to three lines and wrap long unbroken text.
- **Input:** the primary search control, `input`; retain its larger size on mobile.
- **Label:** status text, `label`. The result-position count uses the label size with tabular numerals and no wrapping.

The title is deliberately quieter than the editable search field. Preserve sentence case and the existing text hierarchy.

## Layout

The panel is a vertical flex layout. The heading and status toolbar each occupy at least (48px); the search field stays fixed above a separately scrolling results area. Internal side padding uses `spacing.md`, the bottom uses `spacing.sm`, and result padding uses `spacing.md`. Small alignment and label offsets use `spacing.xs`.

- **Desktop:** fixed upper-right panel (380px wide), inset (12px) from the right and the visible viewport's top.
- **Mobile and coarse pointers:** at `max-width: 700px` or `pointer: coarse`, use a bottom panel with (12px) edge insets and width `calc(100% - 24px)`. Position follows the visual viewport so the panel responds to the software keyboard.
- **Height:** fit reported content within the host's limits. The host clamps reported content height to (140–520px), then limits the panel against the visible viewport: half its height on mobile or three quarters on desktop, with the implemented minimum-cap calculation (180px) and an outer viewport allowance (24px). The result list absorbs overflow.
- **Passage visibility:** when an active passage overlaps the panel, scrolling moves it into available space above or below the panel, with (16px) clearance. The recorded desktop and mobile states show the whole selected passage unobscured.

The spacing vocabulary remains (4/8/12/16/24px); the largest step also represents the combined two-sided viewport inset. Do not reflow or restyle the host page to make room for the panel.

## Elevation & Depth

One soft offset shadow separates the floating panel from the page: `box-shadow: 0 8px 32px rgba(47,39,30,.22)`. The inside stays flat, with thin dividers and state fills providing hierarchy. The iframe boundary carries the panel radius and shadow; no backdrop dims the page.

**The Single Surface Rule.** Reserve elevation for the panel boundary; result rows use dividers and selection color.

## Shapes

Use the `panel` radius for the outer shell and the `control` radius for fields, buttons, and result rows. Borders and dividers are thin (1px). The fallback passage overlay uses the small `marker` radius.

The extension icon uses a text magnifier with a small four-point AI sparkle in the upper right. Rust (`accent`) backing and ivory (`surface`) strokes and sparkle connect it to Warm Paper. The sparkle is a distinct secondary mark that remains legible at toolbar sizes. Panel icons are authored, unfilled SVG strokes (20px square, 1.8px stroke) with rounded caps and joins. Icon controls occupy at least (44px) in each dimension. The loading indicator is a circular stroke; it is the only continuously animated shape.

## Components

### Icon buttons

Quiet, ink-colored controls sit on a transparent background. Hover adds the hover surface. Keyboard focus uses the accent outline (2px, offset 2px); disabled controls keep their shape at half opacity. Close, previous, and next retain accessible names and browser title hints. No separate pressed animation is implemented.

### Search field

The strongest control combines a search icon and native search input within a rounded, warm taupe border. The input is (44px) high; its parent adds the border. Focus strengthens the border to the accent and adds a (1px) outline around the whole field. The native input's separate outline is suppressed because focus is expressed by the parent. Placeholder text uses the secondary color at full opacity.

### Result rows

Results form a divided list rather than individual raised cards. Each row is a full-width button containing one sentence or adaptive paragraph preview. Headings provide retrieval context and never appear as result rows. A paragraph row replaces its sentence rows when combined meaning is competitive. Only results meeting the relevance cutoff appear. Hover, current selection (`aria-current`), and keyboard focus remain distinct. The current fill takes precedence over hover and adds a 1px inset field-line stroke. Forced-color mode retains selection with a 2px system Highlight outline. Row focus uses an inset accent outline (offset −2px). Rows have a minimum touch height (44px), and previews use the body role.

### Result navigation

The position count sits beside previous and next icon buttons in the status toolbar. The count uses tabular numerals; controls keep their full touch target. The navigation group is hidden when there are no navigable results. Status and position updates are announced politely.

### Searching, empty, and error states

Status uses the secondary label style. Searching adds a rotating stroke (13px content size, 2px border, 0.8s linear cycle). With reduced motion, stop the rotation and leave a static partial accent ring. A completed search with no qualifying results says “No close matches. Try another phrase.” A page without searchable text says “There is no text to search on this page.” Both states hide result navigation. Errors communicate through status text; retry is a bordered, unfilled button with a minimum height (44px). The retry button retains the shared focus and disabled treatment without an added hover fill.

### Floating panel and passage highlight

The panel contains the heading, search, status/navigation, scrolling result list, and a compact footer linking to its open-source code and privacy policy. It remains anchored to the visible viewport while the surrounding page stays interactive. Closing removes the panel and highlight and restores the prior focus where possible.

The active page passage uses an amber background, warm brown passage ink (`passage-ink`), and an amber underline through the CSS Highlight API, with priority above the pale context layer. For a selected paragraph, the whole paragraph receives pale amber and its strongest sentence receives the focused amber layer. For a selected sentence, consecutive neighbors passing the relevance cutoff and lying within ten percentage points of the selected score receive pale amber without underlining. Expansion stops at weak text or structural boundaries. Where the API is unavailable, translucent rectangles follow each text fragment without intercepting pointer input; only the active layer has an outline. Navigation scrolls smoothly by default and immediately with reduced motion; the panel avoids obscuring the selected passage in the same document. Query edits, navigation, document changes, and closing clear both highlight layers.

## Do's and Don'ts

### Do:

- **Do** keep the search field strongest and the result position and navigation controls easy to find.
- **Do** preserve system fonts, the compact spacing scale, and both theme palettes.
- **Do** retain accessible names, visible keyboard focus, and minimum 44px touch targets.
- **Do** keep result previews readable and the selected page passage visible outside the panel.
- **Do** honor reduced motion for the loading stroke and passage navigation.

### Don't:

- **Don't** add decorative imagery, gradients, technical badges, or custom panel display fonts.
- **Don't** turn divided result rows into elevated cards.
- **Don't** place relevance scores, progress percentages, runtime details, or developer evaluation controls in the user flow.
- **Don't** dim or restyle the underlying page to accommodate the panel.

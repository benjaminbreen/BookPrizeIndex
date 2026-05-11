# Design Language

The Book Prize Index should feel like a restrained editorial research tool: quiet, typographic, source-aware, and built for scanning dense cultural data. Avoid generic SaaS styling, decorative cards, and marketing-page composition.

## Reference Patterns

Use these pages as the current design models:

- `/subjects`: simple browse table for choosing an entity.
- `/books`: dense catalog table for ranking, filtering, and comparing records.
- `/subjects/[slug]`: entity detail and insight page, with a focused header, compact metrics, a contextual book list, and a right-side insight rail.

Future pages should extend one of these patterns rather than inventing a new layout.

## Visual Principles

- Swiss-minimalist editorial structure: strong grid, measured whitespace, hairline rules, restrained typography, and data accents used sparingly.
- The page title owns the hierarchy. Metrics, filters, and panels are supporting metadata.
- Data surfaces should be square or nearly square. Use `2px` radius for controls and framed surfaces.
- Search bars are the main exception: they use pill radius to signal global/local search.
- Chips and taxonomy tags may remain pill-shaped because they behave like labels or removable filters.
- Avoid large rounded cards, nested cards, decorative blobs, oversized shadows, and one-off gradients.

## Color System

Global page colors live in CSS variables in `app/globals.css`:

- `--paper`, `--panel`, `--ink`, `--muted`, `--line`
- `--accent`, `--accent-soft`, `--focus`
- `--data-*` variables for chart and taxonomy accents

Use Tailwind for layout, spacing, responsive behavior, and typography utilities. Use CSS variables for theme colors, semantic data colors, and dark-mode parity.

Do not add arbitrary hex colors in components. Add or reuse a named CSS variable instead.

Subject pills and topic mix bars should use the shared data accent variables. Topic mix colors are ordered data-series colors; subject pills are semantic category colors. They should feel related but do not need to be identical.

## Controls

Common controls should use the shared CSS classes and small primitives where possible:

- `subjects-search` for large pill search fields.
- `subject-detail-search` for compact pill search fields.
- `filter-toolbar` for horizontal filter bands.
- `segmented-control` and `segment-button` for mutually exclusive toggles.
- `filter-select` for selects.
- `filter-action` for secondary action buttons.
- `SearchModeSelect` from `components/ui/design-primitives.tsx` for keyword/semantic mode.
- `EntityMetricGrid` from `components/ui/design-primitives.tsx` for compact entity stats.

Controls use `2px` radius unless they are search bars or chips.

## Page Types

### Simple Browse

Model: `/subjects`.

Use for subjects, awards, topics, and other browse indexes where the main question is "where should I go?"

Structure:

- editorial header
- large search if lookup is central
- compact filter toolbar
- small-column table or list
- mobile cards

### Dense Catalog

Model: `/books`.

Use for large record sets where users need ranking, filtering, and comparison.

Structure:

- editorial header and shared pill search
- visible primary filters such as geography, subject, and sort
- progressive reveal for advanced filters
- dense sortable table on desktop
- mobile record cards
- density controls when row height materially changes the workflow

### Entity Detail And Insight

Model: `/subjects/[slug]`.

Use for subject, topic, publisher, imprint, and similar detail pages.

Structure:

- entity eyebrow, title, deck, and compact context line
- compact metric grid on the right
- local search/sort toolbar
- main book list or table
- right insight rail for related entities and mix panels

Insight rails should be bordered data panels, not decorative cards. They should align to content height and not stretch to match the main table.

## Motion

Animation should be quiet and functional:

- search focus may subtly brighten/darken the surface and deepen shadow
- table rows may use a small tint or inset accent on hover
- chart bars may animate in with a short, smooth fill
- icons may shift or scale subtly on active state

Respect `prefers-reduced-motion`.

Avoid bounce, large scale effects, page-level motion, and decorative animation.

## Mobile

Every reference pattern must remain useful on mobile:

- tables collapse into cards when horizontal scanning would be poor
- filter toolbars wrap cleanly and controls remain tappable
- metric grids must not overflow or wrap awkwardly
- search bars can lose pill radius on very small screens if needed for usable wrapping
- text must not overflow controls; prefer truncation or wrapping over compressed illegibility

Before finalizing a UI polish pass, inspect desktop and mobile layouts for `/books`, `/subjects`, and `/subjects/[slug]`.

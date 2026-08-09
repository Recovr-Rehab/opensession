# Working on the Open Session web UI

The root `AGENTS.md` still applies. This file defines the consistency rules for
everything under `src/frontend/`. Preserve the established Open Session visual
language instead of introducing a new local style for each feature.

## Copy and naming

- Use sentence case for headings, buttons, menu items, tabs, field labels, and
  empty states. Do not use title case or decorative ALL CAPS. Proper nouns and
  established acronyms keep their normal capitalization.
- Keep copy short, direct, and specific. Buttons describe the action (`Create
  session`, `Try again`); headings name the place or object (`Model providers`).
- Reuse the product's existing terms. Do not casually rename projects, sessions,
  workspaces, automations, runs, reviews, or other established concepts.
- Prefer plain language over implementation details. Errors should say what
  happened and, when useful, what the person can do next.
- Use an ellipsis only when an action requires more input before it happens,
  not as decoration or to make labels feel softer.

## Components

- Search `src/frontend/ui/` before building a control. New buttons, menus,
  modals, sheets, popovers, tooltips, switches, page headers, settings rows,
  loading states, empty states, and alerts should use the existing primitive.
- Use `Button` for actions and glyphs from `components/icons.tsx` for interface
  icons. Icon-only controls need an accessible name and usually a tooltip.
- Build new interactive primitives on Base UI and wrap them in `ui/`. Keep the
  composable Base UI parts API; do not replace it with a large prop-driven
  component or bypass its focus and keyboard behavior.
- Put reusable visual vocabulary in `ui/`; keep feature-specific composition in
  `components/`. Extract a primitive only when more than one surface should
  intentionally look and behave the same.
- Do not create one-off versions of an existing card, spinner, empty state,
  alert, button, or popup. Extend the shared primitive with a small, general
  variant when the difference is genuinely reusable.

## Styling

- Use Tailwind utilities for new and touched UI. `styles/legacy.css` is empty
  and stays that way; component styling lives in a `lib/*-classes.ts` string
  beside its component, or in a primitive in `ui/`. A class name left on the
  markup is a hook for something else (base.css, a `closest()` call, another
  module's `[.that-class_&]`) — say which, in a comment, or drop the name.
- Use the semantic tokens from `styles/tailwind.css`, such as `bg-panel`,
  `text-fg`, `text-dim`, and `border-line`. Never add raw color values or stock
  Tailwind palette colors to product UI.
- Compose classes with `cn()`. Accept and merge `className` in shared
  primitives so callers can adjust layout without copying the component.
- Paint interaction states with the hover washes — `hover:bg-hover` /
  `bg-pressed` in Tailwind, `var(--hover)` / `var(--hover-strong)` in
  `base.css`. They are translucent ink, so one token reads at the same
  strength on any surface. Do not use `--bg-hover` or `--bg-raised` as a hover:
  they are absolute surfaces, so they land as a heavy wash on `--bg` and a
  nearly invisible one on `--bg-panel`, and `--bg-raised` steps the wrong way in
  one theme. `--bg-hover` stays for the few real surfaces built on it (the
  segmented-control track, the scroll-fade `box-shadow` masks).
- Keep a hover wash proportional to the control. A small icon button should
  paint roughly the box its neighbours do, not its whole 40px target — see
  `paletteIconBtn` in `lib/palette-classes.ts`, which paints on a
  pseudo-element inset by 4px (`before:inset-1`).
- Follow the existing spacing, type, radius, border, and icon scales. Prefer a
  nearby shared component or token over a new arbitrary value.
- Reach for the breakpoint by name: `phone:` and `desktop:`, defined in
  `styles/tailwind.css`. Do not spell it `max-[720px]:` — that compiles to
  `< 720`, not `<= 720`, so at exactly 720px wide the element drops its phone
  value while `base.css`'s own `@media (max-width: 720px)` block keeps one.
- Match the surrounding surface before adding visual emphasis. Accent colors,
  raised surfaces, shadows, and animation should communicate meaning, not make
  a new feature louder than its neighbors.
- Add rules to `styles/base.css` only when they are truly global or
  theme-level — tokens, resets, platform chrome, and the keyframes and
  `@property` registrations that have no element to hang a utility on. Never
  add to `styles/legacy.css`: it is empty on purpose. Component styling belongs
  with the component, as utilities or a primitive in `ui/`.

## Interaction and accessibility

- Use semantic HTML first. Every interactive element must work with a keyboard
  and expose an accessible name; do not make a clickable `div`.
- Preserve visible focus, disabled, loading, error, empty, hover, and pressed
  states. Hover may enhance a control but cannot be the only way to discover or
  operate it.
- Keep touch targets usable on mobile and verify layouts at both desktop and
  phone widths. A desktop-only success is not a finished UI change.
- Use the motion guidance and shared presets from the root `AGENTS.md`. Motion
  should clarify state or spatial relationships, remain interruptible where
  appropriate, and respect reduced-motion preferences.
- Keep destructive actions clearly named and visually distinct. Confirm only
  actions that are difficult or impossible to undo.

## React and verification

- Follow the existing React 19 patterns. Do not add `useMemo` or `useCallback`
  by default; no React Compiler is configured in the build (Bun.build in
  frontend-build.ts has no compiler plugin), so memoize manually — and only
  where a measured re-render cost justifies it.
- Keep component files component-only: put non-component helpers/constants in
  `lib/` or `ui/` modules, because mixed component+helper exports disqualify a
  module from React Fast Refresh and downgrade every edit to a full page
  reload.
- Keep state close to where it is used. Do not add a new context, store, or
  abstraction for state that belongs to one component tree.
- Run `bun run typecheck` and the relevant `bun test` targets after code
  changes. For visible changes, verify the real page at desktop and mobile
  sizes and exercise keyboard interaction, loading, empty, and error states
  that the change affects.

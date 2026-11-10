# @gms/web

Vite + React front end for OpenGrants GMS. `pnpm dev:web` serves it on :5173; with
`VITE_USE_MOCKS=true` every screen renders from the fixture workspaces in `src/mocks/`.

## Accessibility

Target: WCAG 2.2 AA on every applicant-facing and public screen, at desktop (1440) and phone (390) widths.

### Automated, in the test suite

`test/a11y.test.tsx` renders each public and applicant route from the mocks (29 at desktop width,
9 in the phone layouts) and runs `axe-core` (pinned to 4.14.0 in `package.json`) with the
`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` tags. It fails on any serious or critical violation.

```bash
pnpm exec vitest run --project web apps/web/test/a11y.test.tsx
```

jsdom has no layout, so `color-contrast` and `target-size` are switched off there and checked in a
browser instead.

### Automated, in Chromium

Run the same axe build in a real browser against the mock dev server, at both widths, and check
for console errors and horizontal overflow at the same time:

1. `VITE_USE_MOCKS=true pnpm --filter @gms/web exec vite --port 5174`
2. With Playwright, for each route in `test/a11y.test.tsx` and each of 1440×900 and 390×844: load
   the page, inject `node_modules/axe-core/axe.min.js`, run
   `axe.run(document, { runOnly: { type: "tag", values: [the five tags above] } })`, and compare
   `document.documentElement.scrollWidth` with `window.innerWidth`.

Result on 2026-11-10 (27 routes × 2 widths): 66 serious findings before the fixes, 3 after.

| Rule | Before | After | Fix |
|---|---|---|---|
| `label-content-name-mismatch` | 44 | 0 | Avatar links carry their initials plus a visually hidden "Account: name" instead of an `aria-label` that hid the visible text |
| `link-in-text-block` | 10 | 0 | Links inside running text and banners are underlined |
| `color-contrast` | 8 | 0 | Landing stat, funder mark and banner link colors |
| `scrollable-region-focusable` | 2 | 0 | Scrolling table wrappers are focusable, labelled regions |
| `target-size` | 2 | 3 | See below |

The remaining `target-size` findings are at 390px (editor, application status, settings), where a
sticky bar (the editor's validation sheet, the bottom tabs) overlaps a control at the page's
initial scroll position. The control is full size once scrolled into view; axe measures the
unobscured part. Settings was not reachable when the first run was made, so its finding is new
to the count, not a regression.

No console errors and no horizontal overflow on any route at either width.

### Keyboard-only pass

Done in Chromium at 1440 and 390 with the keyboard alone (Tab, Shift+Tab, arrows, Space, Enter, Escape).

Apply:

1. Find funding → Tab reaches the search field, filters and each opportunity; the tab list is one
   stop, and Left/Right move between its tabs.
2. Application editor → every field, the section list, "Insert from library" and Submit are
   reached in reading order; date fields take three stops (month, day, year), which is the
   browser's own control.
3. Submit opens the confirmation dialog with focus inside it; Tab stays in the dialog; Escape
   closes it and returns focus to Submit.

Report:

1. Reports → Tab to the requirement's action button, Enter selects it; the report opens below.
2. "Start report" → Enter; prefilled answers arrive with their source marked.
3. Tab through the fields and type; Space ticks the certification.
4. Submit with something missing: the report stays open, each problem is listed in words beside
   its field and in "To fix" (on phones, a one-line alert above the button).
5. Submit when complete: the report locks, the status reads "Submitted", and focus moves to the
   report's header (the button it was on no longer exists).

Fixed during the pass: focus was dropped to the page body after a report was submitted; the phone
report showed raw field paths when a submit was refused; public pages had no `main` landmark.

Every focusable control shows the theme's focus ring (`.gms :focus-visible` in `src/theme/app.css`).

### Not covered

Screen-reader testing with a real assistive technology (VoiceOver, NVDA, TalkBack) has not been
done. The funder and reviewer screens are outside this pass.

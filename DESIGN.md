# MathQuest Design System Notes

## Visual Direction
MathQuest should balance a practical classroom tool with lightweight game energy. Teacher views should use structured surfaces, restrained color, and predictable controls. Student views may use warmer progress and reward accents while preserving readability.

## Color
- Use indigo/navy for trusted primary actions.
- Use teal or green for success and attendance confirmation.
- Use amber for rewards and points.
- Use red only for destructive or urgent actions.
- Avoid single-hue screens; pair neutral surfaces with meaningful accent colors.

## Typography
- Sarabun is the primary body typeface for Thai readability.
- Mitr is used sparingly for headings, modal titles, and major product labels.
- Use compact headings inside dashboards and cards.
- Avoid viewport-scaled text.
- Keep letter spacing at zero unless a component already requires a small label treatment.

## Layout
- Keep app screens as full-width workspaces with constrained inner content.
- Use cards for individual data groups, repeated items, modals, and tool surfaces only.
- Avoid nesting cards inside cards.
- Teacher pages should favor scan-friendly grids and tables.
- Student pages should prioritize one-handed mobile use.

## Components
- Buttons should have clear states and at least 44px touch height on mobile.
- Icon-only controls need accessible labels and hover/focus affordances.
- Tables should scroll horizontally on narrow screens instead of squeezing text.
- Forms need visible structure and clear disabled/loading states.
- Shop items should keep stable image and action areas to prevent layout shift.

## Motion
- Use short, calm transitions.
- Avoid bounce easing for routine UI.
- Support `prefers-reduced-motion`.
- Reserve celebratory motion for rewards, level changes, and explicit success events.

## Responsive Rules
- Student experience must be polished from 320px wide upward.
- Teacher controls should wrap into rows rather than overflow.
- Modals should use dynamic viewport height and internal scrolling on phones.
- Primary actions should remain reachable without horizontal page scrolling.

## Print
- Attendance and reward summaries should print in clean, high-contrast black text.
- Hide interactive controls in print views.
- Avoid dark backgrounds and decorative effects when printing.

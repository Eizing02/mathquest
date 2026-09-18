# Reports update

## Deploy

1. Run `20260915_01_report_bonus_points.sql` in the existing Supabase project before deploying the application. It adds bonus metadata and an insert trigger only; it does not change XP, balances, or existing redemptions.
   Then run `20260918_01_backfill_special_bonus_points.sql` once to assign 1/2 points to the two existing special-point products and their historical redemptions.
2. Deploy `app.js`, `reports.js`, `report-preview.html`, `report-print.css`, `index.html`, and `style.css` together.
3. In the teacher shop, edit each bonus item and set its explicit bonus points per unit. Leave physical items at zero. Do not infer points from an item's name.
4. Check a known student against attendance, orders, and pet costs. Open PDF preview, then use Print / Save PDF at A4, 100% scale, with the browser's own headers/footers off.

New redemption rows capture bonus points at creation. Old missing/zero rows use the current catalog value and the report discloses that fallback. A recognized special-point item with no configured value blocks export with a clear error instead of printing a misleading zero.

## Semantics

- Attendance is filtered by Bangkok year/month. Counts are log counts, not inferred school days. Duplicate student/day logs are reported, not deleted.
- Bonus totals include approved rows only. They are separate from attendance XP.
- Historical date filters refer to the redemption creation date. Status is the current status, not a reconstruction of status on the selected end date.
- Wallet reports always show current lifetime balances. Pending orders reserve coins; rejected orders do not deduct them. Pet costs are included. A failed pet read prevents export instead of silently omitting costs.
- Free means zero-cost redemption, matching the existing app's storage model; that model cannot distinguish a teacher gift from another zero-cost redemption without additional source metadata.
- Each export reloads paginated data with its own captured filters. This prevents stale UI cache exports; concurrent database changes are not a transactionally frozen snapshot.
- CSV and Excel retain names on every row for sorting. PDF suppresses repeated identity cells within a student group and restores them on continuation pages.
- Print pages are measured after styles/fonts load. Each page owns its heading, column headers and page number. Very long rows fail explicitly instead of clipping.
- PDF opens the same-origin `report-preview.html` document. Progress is visible beside the export controls; cancellation aborts report reads and closes unfinished previews. Exports have a 45-second deadline; preview/font loading has a 12-second deadline. All paths restore export buttons.

## Verification

Run `node --check app.js`, `node --check reports.js`, and `node scripts/test-reports.cjs`.
For browser/PDF checks, make Playwright available through `NODE_PATH` and run `node scripts/test-reports.cjs --browser` (Edge). It uses synthetic data and writes QA output to `tmp/pdfs`; it does not authenticate to or write the live database.

The browser suite covers multi-page portrait/landscape reports, row preservation, current wallet arithmetic, capped pagination, year filtering, activity, bonus snapshots/fallbacks and teacher controls at 390/768/1280 px.
It also clicks the actual PDF button to open a new preview window, clicks CSV/Excel through the paginated read pipeline, and verifies button recovery after database errors, timeouts, cancellation and failed preview CSS.

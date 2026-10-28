# Mandatory location check-in

Student self-check-in now requires Google identity, the active class PIN and a
fresh browser location. The school point is latitude `17.131333`, longitude
`102.103092`, radius **100 meters**. The teacher's iPad does not define the point.

## Install on MathQuest

1. Back up and close/cancel any active PIN session. Install the existing Google
   login migration first if it is not already installed. Do not rerun old setup
   files or run MathQuest SQL in ScanSob.
2. Run ONLY the new `20261028_01_attendance_geofence.sql` in the **MathQuest**
   Supabase SQL Editor as the database owner. It installs PostGIS in `extensions`
   if absent, creates private policy/request/evidence tables and replaces the
   public PIN-only entry point with a refusal. No attendance is reset or renamed.
   It is transactional and rerunnable without replacing data or policy values.
3. If PostGIS is already installed outside `extensions`, or there are custom
   attendance write policies, the migration stops without applying changes.
   Review those customizations; do not drop data, remove the guard or blindly
   relocate an existing extension. A lock timeout also rolls back safely.
4. Deploy `app.js`, `google-auth.js`, `index.html`, `attendance-location.js` and
   `attendance-location.css` together. No new API key or Edge Function is needed.
   Reload old browser tabs: PIN-only clients fail closed after the SQL update.
5. First test with a synthetic student on the deployed site, then test on a real
   iPad and phones from the center, building interior and area boundary. Do not
   declare device accuracy verified based on the simulated browser tests.

New frontend with old SQL shows a specific GPS-migration message instead of
falling back to PIN-only attendance. Old frontend with new SQL cannot check in
without location. Run this rollout when no lesson is using the site. Rolling
back the frontend alone does not restore PIN-only access; teachers can use their
existing manual tools while a reviewed forward repair is prepared.

If SQL Editor shows a one-row `pg_advisory_xact_lock` result instead of the usual
success message, an older copy of this installer used `SELECT` for the lock.
That blank `void` result is not an error and does not prove that the rest of the
script ran. In a NEW query, run the read-only diagnostic
`supabase/diagnostics/verify_attendance_geofence.sql`. Expect
`GPS_SQL_INSTALLED` and all boolean columns `true`. Do not rerun the installer
just to get a different message. The installer now uses `PERFORM` inside `DO`,
which acquires the same lock without an unrelated result table. The diagnostic
checks schema objects and permissions, not policy row contents or live GPS.

## Acceptance policy

- Browser location must be supported in a secure context and permission granted.
  The website cannot turn on operating-system GPS for the user or prove the
  device's positioning source. Wi-Fi-only iPads may report poor fixes.
- `enableHighAccuracy: true`, `maximumAge: 0`, up to 20 seconds of observation.
  Watching stops as soon as a qualifying fix is obtained, on failure/deadline,
  account change, logout, page hide or navigation. There is no background track.
- Reported accuracy must be finite, positive and at most **50 meters**.
- The server requires **distance + reported accuracy <= 100 meters**. This is
  intentionally conservative near the boundary; it does not enlarge the zone.
  Distance 60/accuracy 20 passes. Distance 90/accuracy 30 requires retry or teacher
  review. GPS confidence is an estimate, not proof of physical attendance.
- Supabase computes WGS84 geography distance in meters with PostGIS, validates
  ranges, links, PIN, class, session and data/policy versions, and runs the
  existing check-in core only after the location checks pass.
- Server-issued requests live for 60 seconds and bind to the verified Google
  user/session, roster link version and active lesson. Client fix age is bounded
  to 15 seconds, but remains client-provided data, not GPS attestation. No browser
  location system or nonce can guarantee that a determined user did not spoof a
  coordinate. The fixed point is not a secret or an authentication credential.
- Issuance is rate limited. Each identity has one outstanding unused request.
  Duplicate successful submissions replay a frozen receipt without awarding
  points again. Very old requests are pruned when preparing new check-ins.
- The existing 5/3/0 scoring uses server completion time, including time spent
  acquiring location; it is not backdated using a client timestamp. Bangkok
  opening-date behavior, duplicate protection and lesson identifiers are kept.

## Teacher exception and data lifecycle

Students cannot skip the check. A teacher may verify the person and use existing
individual/bulk attendance tools, including activity/leave/absent statuses.
Private `attendance_location_checks` records identify teacher-written rows as
`teacher`. Teacher edits replace previous GPS evidence rather than leaving a
misleading GPS verification. SQL Editor maintenance invalidates changed proof
without pretending it was an authenticated teacher action. Old rows are not
retroactively labeled as GPS-verified.

Only method, distance, accuracy, server time, policy version and (for teacher
edits) teacher auth ID are retained as evidence. Raw student latitude/longitude
is transient and is not stored in attendance, receipts or browser storage, or
explicitly written to MathQuest application logs. Infrastructure log retention
is controlled separately by the hosting/database provider and needs review.
The policy table contains only the school's fixed point. Evidence and completed
requests cascade away when attendance is deleted/cancelled. Changing the school
data version clears all requests. Clearing/changing a lesson removes unused
requests from that lesson. Term reset retains the school location policy.

Existing attendance/reward exports, coins, levels, pets, Google links and ScanSob
contracts are unchanged. Teacher override provenance is private audit metadata,
not a new export column. No student gets points merely for granting permission.

## Verification

`node scripts/test-attendance-location.cjs` uses isolated PGlite with the actual
PostGIS extension, the real installed Google/ScanSob migrations and retired
legacy attendance invoker functions. It checks migration rollback/reruns,
policy/role boundaries, inside/outside/uncertain fixes, invalid numbers, expiry,
link/policy changes, replay, late evidence-write rollback, teacher provenance,
5/3/0 points and Bangkok dates. These tests do not certify live Supabase settings
or multi-session locking under a production workload.

Install QA-only packages outside the repository when needed:

```powershell
npm install --prefix "$env:TEMP\mathquest-geo-qa" --no-audit --no-fund @electric-sql/pglite @electric-sql/pglite-postgis
node scripts/test-attendance-location.cjs
```

`node scripts/test-attendance-location-ui.cjs` uses Playwright/Edge, synthetic
Google identity and intercepted SDK/RPC traffic. It exercises permission errors,
poor fixes through the full 20-second deadline, cleanup, account cancellation,
server refusals, network retry and 320/390/768/1280px layout. Images are written
under ignored `tmp/attendance-location/`; pass `--no-capture` to skip images.
Set `NODE_PATH` to the available Playwright dependency directory if needed.
The Google auth UI regression also exercises the new RPC with an emulated
location. Neither suite sends real scores or uses real device GPS.

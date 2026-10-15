# ScanSob receiver lifecycle 1.1 (wire schema 1.0)

## Scope and compatibility

MathQuest remains static HTML/Vanilla JS on Vercel. Supabase Edge Functions handle server-to-server pairing and score ingestion; a single PostgreSQL RPC commits each batch and its receipt atomically. No browser-to-ScanSob database connection, no shared teacher password and no score-to-XP/MathCoins conversion.

Source examined: `Eizing02/OMRScanner`, original contract commit `c9b14e0fc0dcaa7fca086e965b86ee0b53c173d3` and recovery commit `717198b9759019589ce6d477eda12ce6aafe61a2`, including SQL 011 and the updated handoff. Receiver metadata limits match that contract: title 3-120, subject 1-80, classroom 1-30, five exam types, year 2500-2700, term 1-3, score/max <=6000, strictly UTC timestamps, revisions up to Number.MAX_SAFE_INTEGER, 100 rows/batch and 100 batches/revision, max request 256 KiB. Invalid score shape/range is HTTP 400, matching source validation. Percentage tolerance is 0.011. `passed` is source-authoritative, not recalculated using an invented threshold.

Both receiver flags start OFF. No production SQL or Edge deployment is performed by the local test scripts. Local tests do not certify production Google sessions, Dashboard grants, source scheduler or a live cross-project release. Do not enable source production flags until the staging matrix passes and deployment is approved.

## New files

- `20261015_02_scansob_receiver.sql`: run only after Google migration; additive and rerunnable, never run supabase_complete.sql again.
- `20261015_03_scansob_recovery_hardening.sql`: additive upgrade after 02, binding score visibility to its publishing connection, permanent cancellation tombstones and audited purge evidence. Existing installations of 02 run ONLY 03; do not rerun 02 over this upgrade. It does not reset data, enable flags or require new secrets. The updated UI requires receiver_profile 1.1.
- `supabase/functions/ingest-scansob-results/index.ts`
- `supabase/functions/pair-scansob-workspace/index.ts`
- `supabase/functions/_shared/scansob-contract.mjs`, `scansob-http.mjs`
- `supabase/config.toml`: only these two opaque-token endpoints have verify_jwt=false. Their own authorization is mandatory; database ingress RPCs grant execution to service_role only.
- `scansob.js`, `scansob.css`: teacher settings/report subtab and student scores; not a replacement for existing reports.

## Deployment, in order

1. Back up the existing database. Rehearse the migration on staging with synthetic students. The migration does not reset attendance, shop, pets, passwords, profile photos or Google links.
2. Fresh integration installs run `20261015_02_scansob_receiver.sql`, then `20261015_03_scansob_recovery_hardening.sql`. Existing 02 installs run only 03. The school UUID remains stable. Provenance is backfilled only from unambiguous committed batch/event history; unverifiable origins stay hidden from students. Teacher audit rows remain available. The single-school roster boundary is unchanged.
3. Install/login to Supabase CLI and link the MathQuest project. The current frontend project ref is `jckuqyohylttctzcaekg`; verify it in the Dashboard before linking.
4. Generate a strong, random server secret (at least 32 random bytes) and set **SCANSOB_PAIRING_DELIVERY_KEY** as an Edge Function secret. Use a secret manager or a protected env file outside Git and shell history. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are Supabase runtime secrets; never put these credentials in app.js, Vercel public variables, a student browser, logs or chat.
5. On a fresh install, deploy both functions. An existing 02 deployment needs no Edge redeploy for 03: HTTP code, endpoints, RPC signatures and wire schema are unchanged; SQL changes the lifecycle underneath those RPCs.

```powershell
npx supabase functions deploy pair-scansob-workspace
npx supabase functions deploy ingest-scansob-results
```

The supplied config sets verify_jwt=false for those functions. Verify the deployed configuration; do not disable JWT verification on other functions. Their URLs are `https://<MathQuest-project-ref>.supabase.co/functions/v1/<function-name>`, not the Vercel origin.

6. Deploy the static frontend together with scansob.js/scansob.css AFTER 03. Google teacher account remains `piyawatpiwsiri@gmail.com`. Teacher reports/CSV distinguish publish-ready scores from held history; this does not override the independent student-view switch. The UI rejects a pre-03 receiver instead of silently enabling old visibility behavior.
7. In teacher Settings, create a pairing code. It lasts 10 minutes and can create one request. A pending request lasts 24 hours. In ScanSob, the authenticated Workspace owner enters this code. Verify the Workspace UUID with its owner, not just the editable display name, then approve in MathQuest. Source refresh/status receives the scoped token server-to-server.
8. For staging, configure the ScanSob server's MATHQUEST_RECEIVER_ORIGIN to the MathQuest Supabase origin. Source uses SCORE_INTEGRATION_ENABLED and MATHQUEST_RECEIVER_VERIFIED; inspect that project's release process before changing them. Its network calls require both flags. No source files or production flags are changed by this work.
9. Enable receiving in the MathQuest teacher UI only for the agreed test. Student viewing is independently gated and requires explicit teacher acknowledgment of the existing self-claimed student-code policy. Test unauthorized accounts before enabling real student viewing.
10. Complete the cross-project staging matrix, inspect production policies and secrets, then approve production rollout. On an incident, disable ingestion/view and revoke affected connections. Do not drop tables or restore public_all policies.

## Credentials and lost responses

Only hashes of pairing codes, request secrets and connection tokens are stored in PostgreSQL. The Edge Function derives a stable 43-character delivery token using HMAC-SHA256 with SCANSOB_PAIRING_DELIVERY_KEY and a domain-separated tuple of request UUID, Workspace UUID and request secret. Protected status replay reconstructs the SAME token; lost responses do not rotate a token out from under a concurrent client. The source contract accepts this token shape without changes. This is the receiver's chosen hash-only recoverable-delivery profile, to be reviewed in the cross-project staging handoff.

Approved requests allow token delivery for 24 hours after approval. Active connections outlive that delivery window. A source can now revoke the exact request using either its bound challenge OR its connection token, including after delivery expires. This never returns a token or score data. Lost revoke replies replay the exact three-field revoked ACK. Do not change the HMAC key while there are pending deliveries; no automatic token rotation is implemented.

A protected status lookup of a never-registered request closes that request ID with a challenge-bound permanent tombstone and returns `expired` without connection data. Revoke then returns the exact revoked ACK; a late request cannot activate that ID. Wrong challenges/Workspaces remain generic 403. Unknown-ID closures are limited to 30/hour globally, 5/5 minutes per Workspace, 10,000 stored IDs, and the existing global pairing cap. Hitting the bound returns 429, not a false success. Do not delete tombstones to make a late ID reusable. See the recovery handoff before changing this policy. Teacher revocation remains immediate.

## Ordering and read visibility

- Verify active token, connection, score:write scope, Workspace and destination-school membership before writes or receipt replay. Revoked credentials never retrieve a saved ACK.
- Event deduplication uses SHA-256 of exact received UTF-8 bytes, not JSON reserialization. Same ID/different bytes or a replacement event occupying the same revision/batch is 409.
- Exam watermarks are school + Workspace + source exam, independent of connection. Per-Workspace, event and exam transaction locks protect concurrent requests. Re-pair does not reset revisions.
- Manifests bind action, metadata and batch count. Contradictory manifests or same-revision conflicting student results are 409 without score writes.
- Only included students are upserted. Missing students/batches are never deleted. A revision belongs to one connection; replacement batches from another connection conflict. Teachers see partial counts and retained history. Students require both the score row's original publishing connection and the current revision's publishing connection to be the SAME active connection, plus complete batches and school membership. Reapproval alone cannot resurface old data. Omitted rows within one active publishing lifecycle remain visible; omitted rows from older connections remain stored but hidden. Each row retains its own revision.
- Higher withdrawal removes scores/issues and preserves the exam watermark. Delayed lower publications get stale_ignored. A genuinely higher authorized publication can republish unless its term has been closed.
- Matching is exact string code + authorized school roster, never names/classes, never auto-padding or auto-creating students. No nonstandard-code alias workflow is invented in v1.
- Fix unmatched roster codes, then publish a NEW revision from ScanSob. Replaying an old event returns its original ACK. The receiver UI does not rewrite ACK history or manufacture a resync command unsupported by ScanSob.
- Private tables have no browser CRUD grants. Students call mq_scansob_read without a student ID; JWT-derived Google mapping and school membership determine visibility. Guests, unlinked users, disabled student viewing, revoked connections, withdrawn/incomplete/reset exams cannot expose scores. Teacher mutations require the Google-bound teacher token.
- Teacher CSV reads every page and verifies an import/reset/connection-state snapshot before download. Concurrent imports/resets/revocations abort export rather than mix versions. A publication-state column explains held rows without implying the global student-view switch is on. Existing PDF/Excel/attendance exports are unchanged.
- Google verifies the account, not ownership of a self-claimed roster code. This remains an explicit privacy risk; the new switch acknowledgment is not ownership verification. No OTP/approval has been added to student login.

## Permanent end-of-term reset

Source SQL `mathquest_service_revoke` refuses to revoke a connection with unwithdrawn publications (PUBLICATION_WITHDRAW_REQUIRED). Therefore the receiver blocks a routine term reset while any still-active Workspace has an unwithdrawn exam. Ask each source Workspace owner to withdraw its published exams and wait for successful receiver ACKs first; no new dates are required. This avoids deleting/revoking underneath an active source that would then be unable to complete its own withdraw/re-pair preflight.

Emergency teacher revocation remains unconditional. ScanSob SQL 011 now implements paused recovery through the bound revoke ACK, retains historical publication guards and requires a higher-revision withdrawal at the original school before republishing. Scores from that old connection stay hidden throughout approval and token delivery of the replacement.

The existing Google reset RPC is extended in the SAME transaction and uses the same exclusive school lock as attendance/shop reset. It deletes imported student scores, unmatched student codes, batch details and event ACKs containing student codes; clears exam titles/metadata; revokes all integration connections/codes/requests; disables receiving and student view. Accounts, old passwords, photos and Google links survive.

Only non-score control metadata remains: stable school/Workspace/exam IDs, highest revision/tombstone, closed year/term, a minimal purge receipt (reset UUID, prior revision and timestamp), and security audit. This is NOT a score archive. Old tokens cannot ingest or retrieve saved ACKs. Closed-term publications still receive exactly `403 {"error":"TERM_CLOSED"}`.

Recovery after an actual purge: a NEW active connection for that same Workspace/school may send a NEW higher-revision `withdraw_exam`. The receiver checks its preserved empty reset tombstone and matching purge receipt under the school/Workspace/exam locks, verifies no scores/issues remain, commits a new immutable ACK and audit record, and returns the ordinary `processed` ACK with accepted 0 and empty issue arrays. This confirms actual deletion, not an inference from TERM_CLOSED. Unknown exams, other Workspaces, absent/mismatched evidence or retained scores are denied. Closed publications never become allowed. Titles/student data are not restored into the reset tombstone.

**Cross-project release gate:** source 011 currently blocks closed-term withdrawal in its UI, command retry, outbox claim and cleanup gates. ScanSob must make an explicitly consented historical `withdraw_exam` eligible for dispatch/retry while continuing to block `publish_results` and preserving its closed-term marker. Only the committed processed withdrawal ACK may clear its same-school historical guards. MathQuest has not edited or migrated ScanSob. See `20261015-scansob-recovery-handoff.md` for the exact follow-up; keep live flags/scheduling off until jointly tested.

## Tests

```powershell
node scripts/test-scansob.cjs
node scripts/test-scansob-contract.cjs
node scripts/test-scansob-recovery.cjs
node scripts/test-scansob-postgres.cjs
# NODE_PATH must resolve Playwright from the workspace dependency runtime
node scripts/test-scansob-ui.cjs
```

Local test dependencies are external to the repo, under the configured SQL_QA_MODULE_ROOT (default %TEMP%/mathquest-sql-qa/node_modules): @electric-sql/pglite, pg, embedded-postgres, and zod 4.6.5. The source contract comparison reads SCANSOB_SOURCE_DIR (default %TEMP%/mathquest-scansob-reference). Never point SQL tests at production. The PostgreSQL test creates a disposable loopback-only cluster, uses synthetic accounts, stops it in finally, and leaves its temporary directory for inspection. Tests cover simultaneous duplicates/revision/withdrawal races, 1,005 scores in reverse batches, late-failure rollback, pairing/recovery/revoke, RLS/ACL, null-query denial, exact raw hashes, source schema compatibility and responsive UI. Browser tests mock/block production requests. Real Supabase/Google/two-project end-to-end verification remains a deployment prerequisite.

## Official references

- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/deploy
- Source: https://github.com/Eizing02/OMRScanner/tree/c9b14e0fc0dcaa7fca086e965b86ee0b53c173d3/lib/integrations/mathquest

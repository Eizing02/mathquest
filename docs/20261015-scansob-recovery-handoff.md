# MathQuest recovery follow-up to ScanSob

15 October 2026. MathQuest implementation is local until separately deployed. No real scores, production SQL, source edits, environment changes or live release approval are implied. Reviewed source main: `717198b9759019589ce6d477eda12ce6aafe61a2` (SQL 011).

## Install boundary

Existing MathQuest receiver 02 installs apply ONLY `20261015_03_scansob_recovery_hardening.sql`, then deploy `scansob.js` / `scansob.css`. Fresh installs apply 02 then 03. Do not rerun 02 over 03 or execute ScanSob SQL 011 in MathQuest. No new secrets, HTTP actions, endpoint names, payload fields or ACK fields are introduced. Existing deployed Edge Functions call the same RPC signatures and need no code redeploy for this upgrade. Browser RPC responses identify receiver_profile `1.1`; the public wire remains `schema_version: "1.0"`.

## 1. Re-pair does not republish history

Each imported score has its publishing connection, and each current exam revision has its publishing connection. Student visibility requires those to be the same ACTIVE connection at the authorized school/Workspace, complete current batches and the student's current roster link. Teacher approval of a replacement connection alone cannot expose old retained scores, before OR after token delivery. Rows omitted within the same active lifecycle retain additive semantics. Rows belonging to an old connection stay hidden until explicitly republished through the new lifecycle. A different connection cannot append to an existing revision.

Migration backfills only single-connection committed batch/event evidence. Ambiguous/missing history remains hidden; teachers see its reason. No student identity verification gate was added: Google -> roster lookup/preview -> explicit claim/switch remains the owner-approved policy. Actual deployed account switching and authorization still need acceptance testing.

## 2. Exact cancellation ACK, including the unregistered and expired cases

The existing `revoke` action now accepts the request's original 43-character `request_secret` as a cancellation credential even when approved or past the 24-hour token delivery deadline. The challenge is hash-checked and bound to the exact request and Workspace; an optional connection_id must match. A token can still revoke only its own connection, including replay after admin revocation. No cancellation response contains a token or scores.

Committed success stays EXACTLY:

```json
{"schema_version":"1.0","request_id":"<same UUID>","status":"revoked"}
```

Request/status/revoke use the same Workspace/request transaction locks as approval and reset. An approval between source status and revoke cannot escape cancellation. A lost ACK retries safely.

For a never-registered request, protected `status` atomically reserves a terminal, challenge-bound cancellation tombstone and returns EXACTLY `schema_version`, `request_id`, `status: "expired"`. There is never a connection object. A subsequent bound revoke returns the committed revoked ACK. A late original request with that ID returns expired and cannot consume a code or activate. A direct bound revoke can also close an unregistered ID. This is a deliberate terminal lookup, not proof inferred from an arbitrary 403/404. Use a fresh UUID/code for a new pairing.

Tombstones store no plaintext challenge, code, token or student data. Creation is bounded to 30/hour globally, 5/5 minutes per Workspace and 10,000 unknown IDs, in addition to the global pairing cap. At the bound, return 429 with numeric Retry-After; keep recovery pending. Wrong Workspace/secret remains generic 403. An unregistered request carrying an asserted connection_id or Bearer token is denied: closing an unknown request must not falsely certify revocation of a different connection. Tombstones must not be pruned to allow delayed requests to activate. Established-request cancellation does not consume this unknown-ID storage allowance.

Source 011's existing protected-status -> recovered token if active -> revoke -> local finish is compatible. Preserve its encrypted challenge for expired/error states until the exact revoke ACK. Do not treat every 403/404, expiry, network failure or invalid ACK as cancellation success.

## 3. Audited withdrawal after receiver term purge

`publish_results` into a closed term remains `403 application/json` with exactly `{"error":"TERM_CLOSED"}`. No term reopening or relaxed scope is added.

Previously committed byte-identical event retries retain their frozen ACK, and lower revisions retain stale_ignored ordering. Neither path writes scores or reopens the term; stale_ignored is still not proof of withdrawal.

After a reset, the receiver retains a minimal per-exam purge receipt: exam control ID, reset UUID, prior revision and purge timestamp. No names, student codes, scores, titles or result payloads are archived. Historical reset tombstones are adopted only when their reset flag, empty metadata and absence of scores/issues/batches can be verified at migration time.

A new active authorized connection at the SAME school/Workspace can submit a NEW higher-revision `withdraw_exam`, batch 0 of 1, results empty, using the historical exam metadata. The receiver must prove the matching exam's reset tombstone is still empty and backed by its purge receipt. It then commits its watermark, withdrawal batch, frozen ACK and `ack_purged_withdrawal` audit record atomically. The response is the EXISTING processed score ACK, accepted 0, unmatched/invalid empty. Byte-identical replay returns the same ACK. Unknown/mismatched evidence is not success; old revisions remain stale and closed publication remains forbidden. A timeout after commit is safe to retry.

This is a true committed assertion that the exam's imported scores are gone, NOT a reinterpretation of TERM_CLOSED or a revoke ACK as withdrawal. Teacher audit history remains distinguishable from source publication history.

### Required ScanSob follow-up before this recovery can dispatch

SQL 011 `mathquest_service_claim` currently blocks closed-term jobs regardless of action. Its TERM_CLOSED finish handler also blocks every outstanding job for that term. The source publication UI disables withdrawal when termClosed, and command retry also has a blanket term gate. Those prevent a historical withdrawal from ever reaching this receiver, even though the receiver can now safely acknowledge a proven purge.

Use a NEW reviewed source migration, not edits to installed 011, to:

1. Keep publication/manual-auto/retry guards for `publish_results` and the persistent closed-term marker intact.
2. In `components/integrations/exam-publication.tsx`, permit an explicit historical-withdrawal confirmation under termClosed only when ownership, consent and the original-school active connection checks pass. Keep publish blocked.
3. In the command/retry gate, distinguish a frozen withdrawal from publication using authoritative DB state, not a browser-supplied action override. Permit safe transport retry of that withdrawal only.
4. In claim and TERM_CLOSED cleanup, permit ONLY those consented `withdraw_exam` jobs for the same original destination. Do not revive frozen `publish_results` jobs, auto-publish requests or discarded leases.
5. Keep identity, ownership, lease fencing, immutable payload/event hashes and monotonic revision checks.
6. Mark same-school historical publications withdrawn ONLY after the exact committed `processed` ACK for that withdrawal, never after stale_ignored, TERM_CLOSED, generic denial, malformed ACK or revoke.
7. If a withdrawal itself receives TERM_CLOSED because evidence is unavailable, leave history guarded and show operator recovery. Do not loop indefinitely, mark every exam purged, or clear guards for another school/term.

This follow-up is NOT implemented in the ScanSob project by MathQuest. Its status must be confirmed before production end-of-term recovery is declared complete.

## Joint synthetic acceptance

- Publish -> revoke -> approve new connection BEFORE token delivery: old student score/exam lists remain empty. Check after token delivery too.
- Partial/new batches cannot expose old-connection rows; same-connection additive omission still works. Ambiguous migration history fails closed.
- Approve before cancellation; approve between status and revoke; simultaneous approval/revoke; lost revoke ACK; admin revoke then replay.
- Unregistered status/cancel races against initial registration: no active connection can survive the final revoke. Wrong challenge/Workspace is denied. Exhausted bounds return retryable denial, not false success.
- Active request with expired delivery: no token is returned, but bound cancellation succeeds and re-pairing is possible.
- Same-school higher historical withdrawal after re-pair; wrong-school activation remains denied by ScanSob.
- Closed term publication denied while an open term works. After a real purge, an authenticated higher withdrawal receives processed once; duplicate returns its frozen ACK; unknown evidence never succeeds.
- Source closed-term scheduler exception dispatches only withdrawals and preserves publication/delete guards until validated ACK.
- CSV includes held/publish-ready state and aborts if connections change mid-export. Student identity-switch race discards old responses.

Local MathQuest checks include PGlite lifecycle/ACL/migration regressions, actual-source wire differential cases, real PostgreSQL concurrent cancellation/registration/revision/purge ACK and late-failure rollback, and mocked browser responsive states. These do not certify real Supabase Auth, deployed flags/secrets/scheduler, or a live two-project run. Keep production flags and the runner off until both deployments and the joint matrix are approved.

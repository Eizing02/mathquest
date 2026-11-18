# Student exam scores: release notes

The existing Scores button opens a student page with subject filtering, newest-updated-first ordering and cursor pagination. The route stays in the student shell so Home, Shop and History remain available. A single term is shown in the page header; when results span multiple terms, each result includes its term.

## Rollout

1. In the attendance system Supabase project, apply `20261118_01_scansob_student_score_view.sql` after `20261015_03_scansob_recovery_hardening.sql`. Apply the new SQL before releasing the web files.
2. Deploy the web files. Sign in as a linked student on a test account, open Scores and verify that subject selection searches all visible results. If the RPC is missing, the page shows a Thai message and a retry button.

The additive RPC does not modify scores, enable student viewing, change teacher reports, or require a ScanSob deployment. It derives identity from the existing Google student link and applies the existing score visibility policy to both results and subject options. Teacher names and classroom provenance are outside this release.

## Local verification

- `node scripts/test-scansob-student-scores.cjs` uses a disposable PGlite fixture. It checks the complete initial subject list, sorted pagination with tied timestamps, term summaries, disabled viewing, and student data isolation.
- `node scripts/test-scansob-ui.cjs` uses mocked requests in Edge. It exercises small/large screens, 200% text, subject filtering, retry, focus after paging, and stale responses.
- Test dependencies follow the [ScanSob receiver guide](20261015-scansob-receiver.md). These checks do not connect to production.

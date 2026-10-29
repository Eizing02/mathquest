# Profile Frames: Local QA Handoff

Status recorded 2026-10-29. This is an evidence ledger and remaining-check guide, not an audit score, full certification or whole-surface ship approval. The implementation/deployment contract is in [20261029-profile-frames.md](20261029-profile-frames.md).

## Evidence and Review Status

The following PASS results were supplied from completed local runs. This documentation turn read the implementation/test source and existing captures; it did not rerun these commands or contact production Supabase.

| Supplied evidence | Scope and limits |
| --- | --- |
| `node scripts/test-profile-frames.cjs` - PASS | Isolated PGlite: verified identity, exact link/school version, private table RLS/ACL, cross-student isolation, CAS conflict, rerun, FK correction, real reset-path deletion/rollback and photo retention. Not a concurrent real-server PostgreSQL test. |
| `node scripts/test-profile-frame-assets.cjs` - PASS | All 21 pet IDs, 640px alpha WebPs, high-resolution masters, clear center/face core, payload bounds and exact prompt provenance. Runtime WebPs total about 2847 KiB; masters total about 37.8 MB and are not frontend requests. |
| `node scripts/test-profile-frames-ui.cjs` - latest PASS | Actual app with intercepted test-only authentication/RPC and synthetic photo data; production Supabase blocked. Widths 320/390/768/1024/1280, keyboard, Edge synthesized touch, 200% text, reduced/offscreen motion, no pet, save/persistence, pet changes, missing SQL, network/conflict/404/timeout, picker/crop cancellation, stale identity and session-only Guest. Includes same-pet 404 -> restore asset -> explicit editor reopen recovery, without clearing globals. |
| Existing regression results - PASS | Google SQL/browser and actual-SDK PKCE fixtures; school SQL/UI; reports; ScanSob; GPS/PostGIS SQL/browser. These are supplied existing results, not new runs or production certification. |
| Existing static checks | JS syntax and diff checks passed; Impeccable detector on new CSS/JS returned `[]`; prompt scan covered 42 rasters with 0 missing. These do not certify accessibility or application-wide design quality. |

The reviewer initially identified one P2 image-retry defect. The returned follow-up verdict is **pass**, disposition **ship**, for that single listed/scored image-recovery fix: resolved. The reviewer inspected the recovered Cinder screenshot, source and test and identified no fix-induced regression; the reviewer did not rerun tests. This is a scoped fix verdict, not whole-surface certification or a new full audit score. Application source is frozen, with no further UI/art changes planned.

## Existing Capture Inventory

All required files exist under ignored `tmp/profile-frames/`; these are existing fixture captures, not new production screenshots. This documentation pass visually sampled `editor-320.png`, `editor-recovered-image.png` and the full light/dark contact sheet; the other captures were inventoried, not independently re-reviewed here.

| Capture paths relative to the repository | Evidence |
| --- | --- |
| `tmp/profile-frames/student-{320,390,768,1024,1280}.png` | Five student-dashboard widths. |
| `tmp/profile-frames/editor-{320,390,768,1024,1280}.png` | Five integrated-editor widths. |
| `tmp/profile-frames/frame-contact-sheet.png` | All 21 frames on light/dark backgrounds around a synthetic portrait. |
| `tmp/profile-frames/frame-{ember,aqua,mystic}.png` | Representative warm, water and arcane frame previews. |
| `tmp/profile-frames/editor-no-pet.png` | Empty-pet state. |
| `tmp/profile-frames/editor-reduced-motion.png` | Reduced-motion state; the fixture checks motion behavior, not a still screenshot alone. |
| `tmp/profile-frames/editor-recovered-image.png` | Loaded same-pet frame after explicit reopen recovery. |

## Focused Acceptance Checks

These are handoff steps for later authorized QA, not instructions to mutate a live database or roster now. Use intercepted local fixtures for failures and identity/reset tests.

1. Open [the existing local app](http://127.0.0.1:5173) with **Guest**. Open the camera editor, switch between automatic/no frame and motion on/off, then save/reopen. The current trial session retains the choices, a new independent session starts with defaults, and no preference read/save calls `mq_student_profile_style`. Guest photo replacement stays restricted.
2. With an intercepted linked-student fixture, confirm **เปลี่ยนรูป** opens the picker directly from the user gesture and the cropper appears only after the editor closes. Picker/crop cancellation preserves the original photo. **ใช้รูปนี้** saves only the photo; **บันทึกกรอบ** saves only preferences. Clicking the dashboard portrait still opens the raw-photo zoom viewer.
3. Force a 404 for the current frame. The photo remains visible and the editor retains an actionable image-failure message. Restore the same asset, close and explicitly reopen the editor, without changing pets or clearing globals. One retry cycle uses `?retry=1`; retry-in-progress remains visible until image load clears it. If the asset still fails, the failure message returns and requests do not loop. Later explicit reopen attempts increment the retry parameter.
4. Exercise missing SQL, failed reads, conflicts and uncertain saves in fixtures. Missing SQL names `20261029_01_student_profile_frames.sql` and disables frame save without disabling eligible photo editing. A conflict requires review and another explicit save. After a save timeout, reopen/read back before repeating it. Late identity responses must not restore another account's decoration or photo preview.
5. Verify the five captured widths, keyboard focus/return and no horizontal editor overflow at 200% text. With no pet, frame/motion controls are unavailable. With reduced motion or the user switch off, decorative loops stop; offscreen/hidden-page effects pause, and print hides decoration. Do not infer physical Safari behavior from synthesized Edge touch.
6. In a separately authorized isolated SQL environment, verify revision/CAS and school-data reset rollback alongside retained photos. Do not perform a term reset on production for this check. For deployment, follow the SQL-first sequence and linked-test-account persistence check in the feature guide.

## Remaining Boundaries

- Reviewer pass/ship applies only to the single resolved image-recovery fix, not the whole surface; no full certification or numerical audit score is recorded.
- No axe/WCAG conformance audit, screen-reader certification or physical iPad/Safari certification is established by these fixtures.
- No concurrent real-server PostgreSQL verification, production SQL execution, Vercel deployment or Git push occurred in this documentation turn.
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/`, `.agents/`, application source/assets/SQL/tests, the Git index/commits and older pending student-ID work remain outside the write boundary. Legacy context/schema drift is reported in the feature guide, not repaired or made normative.

# Pet-Themed Profile Frames

## Scope and Direction

This extends the existing student profile, not the teacher UI or the game's economy.
The approved feature brief is an original circular fantasy ornament derived from the current pet's actual palette, with bounded glow and small theme-specific particles. It must leave the photograph readable. The profile editor remains an Operate surface with the existing Sarabun/Mitr typography, colors, Bootstrap modal behavior and Font Awesome controls. No whole-page redesign or new navigation entry is involved.

There are 21 original frames, one for every current pet. The frame follows the active pet automatically. Students can disable the frame or its animation. No additional coins, unlocks or pet-change events are charged. Evolution rules remain unchanged; this version does not introduce 63 evolution-specific frame images.

## Local Preview and Deployment

The local server is already at [http://127.0.0.1:5173](http://127.0.0.1:5173). Use the **Guest** button to try the frame editor without configuring Google login for localhost. Guest preferences last only for that tab's active trial session, not across a new independent session.

**Deployment status (2026-10-29):** the SQL is provided, not run on production. No production frontend/Vercel deployment or Git push was performed in this documentation turn. The reviewer returned **pass**, disposition **ship**, for the single corrected image-recovery issue only, not whole-surface certification. Application source is frozen; no further UI/art changes are planned. See [QA evidence and remaining checks](20261029-profile-frame-qa.md).

For a separately authorized deployment:

1. Confirm `20261015_01_google_login_student_links.sql` is installed, then run the entire `20261029_01_student_profile_frames.sql` transaction in the intended Supabase SQL Editor. It installs a private preferences table, one authenticated RPC and a reset trigger without changing photos, progress or the economy. It is rerunnable without clearing choices; its schema-cache reload notification is included.
2. Deploy the matching `index.html`, `app.js`, `google-auth.js`, `profile-frames.js`, `profile-frames.css` and runtime `assets/profile-frames/manifest.json` plus all 21 WebPs together. SQL is backward-compatible with the old frontend, so install it first. Keep PNG masters and provenance in the source/archive; they are not frontend dependencies.
3. Sign in as a linked test student, choose a pet if necessary, then use the camera button beside the profile photo. Select **บันทึกกรอบ** and check the saved preference in a fresh authenticated browser session. Check photo replacement separately; Guest does not verify server persistence or Google identity.
4. Complete physical iPad/Safari checks for the picker, cropping, modal handoff and frame effects before classroom rollout. The scoped recovery-fix pass does not establish physical-device certification; neither does desktop Edge emulation.

If the SQL is missing, the editor identifies this new migration by filename and disables frame saving. Photo selection and the existing crop/upload path remain available to eligible signed-in students. This migration does not replace the existing Google identity, attendance, shop, bonus, report, ScanSob or GPS contracts, and does not depend on installing the separate pending student-ID correction migration.

## Implementation Map

| File | Installed responsibility |
| --- | --- |
| `profile-frames.js` | Catalog, identity-scoped preference read/save, layered portrait, editor draft, request/error/retry handling and visibility lifecycle. |
| `profile-frames.css` | Portrait-only decoration, semantic-token editor styling, responsive layout, focus, reduced/offscreen motion and print suppression. |
| `index.html` | Frame stylesheet/script, avatar wrapper, camera entry point and integrated Bootstrap profile editor. |
| `app.js` | Six hooks: load preferences after the pet; render on photo set, photo fallback and pet render; await editor close before crop handoff; reset on logout. |
| `google-auth.js` | Two reset hooks: before rendering the identity-link form and before entering a Google account. |
| `assets/profile-frames/` | Runtime manifest/WebPs, high-resolution PNG masters and prompt provenance. |
| `20261029_01_student_profile_frames.sql` | Private preferences, identity/version/CAS RPC and transactional reset trigger. |

## Profile Editing

The camera button opens the integrated profile editor. It previews the existing photo, the active pet frame, a frame/no-frame segmented control and a motion switch. The previous large-photo viewer remains available by selecting the portrait itself; it intentionally shows the underlying photo for zooming.

Photo replacement and frame saving are separate, clearly named actions inside this flow. Selecting **เปลี่ยนรูป** starts closing the style editor and opens the native file picker in the same user gesture; after a file is chosen, crop handoff waits for the editor to finish closing. **ใช้รูปนี้** saves the photo through the original image pipeline. **บันทึกกรอบ** saves only the frame/motion preferences, not a photo or an active-pet selection. Unsaved frame drafts are not saved by changing the photo. Cancelling a frame draft, picker or crop does not replace the stored photo. No frame is burned into an uploaded image.

Guest mode reads and saves cosmetics only through the existing active Guest session; neither operation calls `mq_student_profile_style`. Guest photo replacement retains the existing informational restriction. With no pet, the photo remains and the automatic-frame/motion controls are disabled until a pet is available.

## Failure and Recovery

- **Frame image 404/load failure:** remove decoration and keep the raw photo visible. The editor retains the failure message directing the student to close and reopen it; a preference refresh must not silently erase that image failure.
- **Explicit image retry:** reopening the editor after failure starts one retry cycle for the same active pet and changes its image URL to `<petId>.webp?retry=1` (incrementing on later explicit retries) to avoid a cached failure. During this attempt, an image-retry-in-progress message replaces the failure message, not a success/empty state. Only a successful image `load` clears that image status. Another image error restores the failure message. There is no timer, background retry or automatic retry loop, and no pet switch or clearing globals is required.
- **Missing SQL or failed preference read:** show the applicable error and leave frame saving disabled; photo editing remains separate. After the migration/network is restored, explicitly reopen to reread preferences. A frame catalog failure also permits a later reopen to fetch the catalog again.
- **Save conflict:** the RPC returns current preferences/revision without overwriting them. The editor retains the draft controls and asks the student to review and explicitly save again using that revision; it does not automatically resubmit.
- **Network/timeout on save:** the result may be unknown. The catalog/RPC timeout is 15 seconds, not an automatic image retry deadline. Controls are unblocked; close and reopen to read back the actual preference before trying another save.
- **Changed account, Google link or school-data version:** reject stale work and request a page reload. Owner/serial checks discard late reads and saves for a different identity; reset hooks remove old portrait decoration and editor-photo state.

## Security and Reset

`mathquest_private.student_profile_style` stores only these fields:

| Field | Contract |
| --- | --- |
| `student_id` | Text primary key, FK to `public.students(id)` with `ON UPDATE CASCADE` / `ON DELETE CASCADE`. |
| `frame_enabled`, `motion_enabled` | Non-null booleans, both default `true`. |
| `revision` | Non-null UUID, generated on insert and replaced on each successful update; compare-and-swap (CAS) token, not the school/link version. |
| `updated_at` | Non-null timestamp with time zone, set on insert/update. |

- No uploaded images, frame selections, arbitrary asset URLs or composited photos are stored in this table. The catalog derives the frame from the active pet.
- RLS is enabled, and direct table access is revoked from browser roles and service_role. The narrowly scoped security-definer RPC derives identity from the verified Google session and linked roster row.
- Only `authenticated` receives execute access to `mq_student_profile_style`; it accepts `read`/`save`, the two booleans, `p_expected_version`, `p_link_version` and `p_revision`, never a caller-selected student ID. The existing identity helper verifies the school-data version and the RPC compares the exact Google-link version. Identity and reset advisory locks follow the existing application order.
- A read with no row returns enabled defaults and `revision: null` without creating a row. The first save uses null; subsequent saves must match the stored revision. CAS conflicts return current values/revision without a write. Successful saves use the existing rate limiter (30 per 300 seconds).
- The existing term-reset transaction advances `school_data_version`. A trigger deletes preferences in that same transaction, with rollback if the reset fails. Pet deletion removes the applicable frame; photos and existing identity credentials remain unchanged.
- The new preferences FK uses ON UPDATE CASCADE / ON DELETE CASCADE. This does not alter older FK constraints in the separate pending student-ID migration.
- Installation is transactional and rerunnable without resetting choices. No production SQL is run by the automated tests.

## Images and Motion

The built-in ChatGPT `image_gen` tool produced each independent original frame. Exact generation prompts are in [20261029-profile-frame-prompts.json](20261029-profile-frame-prompts.json), embedded into the PNG masters and retained in `<petId>.webp.json` prompt sidecars. Prompt-requested canvas sizes are not a claim about delivered image dimensions.

| Asset set | Actual dimensions and payload | Frontend loading |
| --- | --- | --- |
| 21 PNG masters in `assets/profile-frames/masters/` | 1254 x 1254 each; 37,817,092 bytes total (about 37.8 MB). | Never loaded by the frontend. |
| 21 alpha WebPs in `assets/profile-frames/` | 640 x 640 each; 2,915,820 bytes total (about 2847 KiB). | Only the active pet's enabled frame at startup, not the entire collection. |

The center and outside of the ring retain real transparency. Art and glow reuse the same runtime WebP URL; no master preload or gallery of 21 startup images is introduced.

Static art stays fixed over a circular photograph. A separate bounded glow layer animates opacity, while four small Font Awesome particles use theme-specific motifs. The image itself is not an animated GIF or video. IntersectionObserver and document visibility pause nonessential loops. The user's motion switch and `prefers-reduced-motion` both disable decorative looping. The photo remains visible if a frame fails to load. Print media hides frame decoration.

## Verification Summary

The supplied latest local results are PASS for `scripts/test-profile-frames.cjs`, `scripts/test-profile-frame-assets.cjs` and `scripts/test-profile-frames-ui.cjs`. They were not rerun in this documentation turn. The [QA guide](20261029-profile-frame-qa.md) records coverage, screenshots, inherited regression results and limitations, including same-pet 404 recovery by explicit reopen. The reviewer's returned pass/ship disposition resolves that single P2 fix after source, test and recovered Cinder screenshot inspection, with no fix-induced regression identified. The reviewer did not rerun tests or certify the whole surface.

For future separately requested runs, use bundled `playwright`/`sharp` through `NODE_PATH` and PGlite through `SQL_QA_MODULE_ROOT`. Reimporting a master with `scripts/prepare-profile-frame-assets.cjs` regenerates WebP; rerun Impeccable `embed-prompt` on regenerated files using the exact saved prompt.

## Incumbent Design Evidence

This ordinary extension preserves `PRODUCT.md`, `DESIGN.md`, `.impeccable/` and the shipped skill files. Compared evidence: the product's task-first classroom brief; incumbent design notes; `style.css` semantic tokens; `profile-frames.css`; editor/avatar markup in `index.html`; the JS hooks; SQL; manifest/prompts/sidecars; QA source and existing screenshot captures. The controls reuse `--pri`, `--ink`, `--ink-soft`, `--white`, `--surface`, `--surface-brand` and `--border-soft`, with Sarabun body/control text, a compact Mitr title, Bootstrap modal behavior and Font Awesome icons.

The editor is at most 640px wide, uses two columns above 575px and one below, and scrolls its body within dynamic viewport height. The portrait is 120px (104px at widths up to 420px); editor art is 240px (216px on narrow screens). Panel corners are 8px and command-button corners 6px; primary actions have 44px minimum height. These are observed local details, not new global tokens or rules. Optional portrait glow/particles are the bounded feature extension to the incumbent calm-motion guidance, not permission to animate the rest of the workspace.

Pre-existing context/schema drift is not repaired or canonized: the incumbent `DESIGN.md` uses legacy headings without normative token frontmatter, and no `.impeccable/design.json` exists. No system refresh, sidecar creation, world redesign or unrelated student-ID work is authorized here.

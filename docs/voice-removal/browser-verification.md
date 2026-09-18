# Focused retired-input browser regression

Added tests/e2e/retired-input.spec.ts: two parameterized browser regressions for 1365x900 and 390x844. Runtime files unchanged.

Each test creates its own synthetic account, promotes only that newly registered app.users row to admin in the explicitly configured isolated DATABASE_URL, signs out/in for a fresh auth session after role promotion, and reloads. It never modifies seeded or personal accounts. CI already passes DATABASE_URL; the test explicitly rejects an unspecified database to avoid unintentional fixture creation in a default database.

Routes checked per viewport: /more, /notifications/settings, /admin (Settings tab), /voice-assistant/settings (redirects to /today), /today, /calendar, /shopping. Assertions cover usable retained controls, keyboard focus on notification settings link, absence of built-in voice buttons/links/checkboxes, no horizontal overflow, zero /api/(v1/)?voice requests, zero getUserMedia attempts, no console/page errors, exact retired storage key cleanup with an unrelated localStorage key preserved, and persisted auth after reload. Observation includes 1.7s beyond the former 1.5s pending-command polling interval.

Final focused executions on current code:

- narrow: PASS 1/1, 12.6s test / 13.1s run; /tmp/planner-retired-input-e2e-narrow.log.
- wide: PASS 1/1, 8.8s test / 9.2s run; /tmp/planner-retired-input-e2e-wide.log.
- Scoped Prettier, ESLint and git diff --check PASS.
- Existing 19 E2E tests were not rerun; root had already validated them.

Environment: DATABASE_URL=postgres://planner:planner@127.0.0.1:55439/voice_e2e; E2E_REUSE_EXISTING_SERVER=1 E2E_WEB_PORT=5190 E2E_API_PORT=3119; Chromium and planner JWT. Initial sandbox run could not reach localhost/tsx IPC, approved retry succeeded. Test fixture development needed responsive auth selectors (mobile registration is a button, mobile task action is New task) and new session after DB promotion because API caches role snapshots30s. These were test setup issues; no product correction was needed.

14 screenshots under /tmp/planner-voice-removal-screenshots:

- admin-settings-narrow.png
- admin-settings-wide.png
- calendar-narrow.png
- calendar-wide.png
- more-narrow.png
- more-wide.png
- notifications-narrow.png
- notifications-wide.png
- retired-route-narrow.png
- retired-route-wide.png
- shopping-narrow.png
- shopping-wide.png
- today-narrow.png
- today-wide.png

Visually inspected admin settings wide+narrow and notifications+old-route narrow: stable full opacity after disabling screenshot animations, intact hierarchy/spacing/controls, no removed voice sections or clipping. Old route screenshot correctly shows Today. Root can inspect remaining screenshots separately.

Limit: desktop Chromium narrow viewport is responsive-web evidence, not physical Android/native plugin/settings or installed upgrade proof.

## Final content-readiness correction

All route captures now require no page-state-skeleton. Today/retired-route wait for the actual Antiperergruz region; calendar waits for the period title and its real day/week/month/schedule region, not only the shell button. Updated full test file PASSED BOTH tests in a single final focused run:

npm notice run planner@1.0.0 npx
npm notice run 'playwright' test tests/e2e/retired-input.spec.ts --project=chromium

Running 2 tests using 1 worker

(node:21627) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
✓ 1 [chromium] › tests/e2e/retired-input.spec.ts:75:3 › keeps retired input absent and ordinary routes usable on wide screens (9.9s)
✓ 2 [chromium] › tests/e2e/retired-input.spec.ts:75:3 › keeps retired input absent and ordinary routes usable on narrow screens (12.5s)

2 passed (23.0s)

All14 screenshot files replaced with final captures. Visually verified wide calendar grid/date controls and loaded Today region. Synthetic first-user owner status is preserved by fixture role setup, allowing safe use on an otherwise empty isolated test DB.

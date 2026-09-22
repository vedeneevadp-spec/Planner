# Web built-in voice removal

## Initial state

- Branch: codex/today-quiet-refresh-1.1.19
- HEAD: 2b40273eca2238e5ae7b89b0b514f00825b45676
- Initial `git status --short`: clean.
- Read user specification, repository AGENTS.md, root and apps/web package.json, inspected app/router/features/shared/public layout before edits.
- Focused baseline: 7 suites / 50 tests PASS; log: /tmp/planner-web-baseline.log.

## Inventory before edits

| Element                                                                                          | Consumers                                   | Action                                                                    | Risk                                    | Verification                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| features/voice-assistant feature, recorder, action handlers, parsers, metrics, tests and exports | App, settings page, voice native references | Delete feature once shared bridge moved                                   | Shared operations must survive          | Import search, web typecheck/tests, bundle scan                                                               |
| pages/voice-assistant-settings                                                                   | lazy AppRouter route                        | Delete page and route                                                     | Old URL blank screen                    | Existing catch-all redirect /today and route regression test                                                  |
| App mount and More settings link                                                                 | App shell/navigation                        | Remove                                                                    | Shell/auth intact                       | Router/More/Auth/session tests and browser check                                                              |
| useSessionAuthController native voice logout cleanup                                             | Sign-out                                    | Remove voice-only import/call                                             | Native token clearing or refresh breaks | SessionProvider/auth regression tests                                                                         |
| useUserPreferences optimistic voice field, fixtures                                              | Preference mutation/session data            | Remove current voice fields                                               | Other settings lost or rejected         | Settings/session regression tests                                                                             |
| Notification settings openAndroidSystemAppSettings                                               | Notification settings page                  | Move to shared/lib/native-app-settings.ts using PlannerAppSettings plugin | Native settings no longer open          | Bridge delegation/rejection/platform tests, NotificationsSettingsPage tests; native integration Android agent |
| client-events web_voice_* union                                                                  | Removed voice runtime only                  | Remove                                                                    | General telemetry broken                | client-events tests                                                                                           |
| planner.voiceAssistant.deviceSettings.v1 / planner.webVoice.sessionId.v1                         | Removed runtime/settings                    | Idempotent exact-key startup cleanup                                      | Loss of auth/offline queue              | Storage access failure, repeat cleanup, sentinel preservation tests                                           |
| public/sw.js chaotika-runtime-v3 and PWA registration                                            | PWA static assets                           | Rotate shell cache; retain IndexedDB/localStorage                         | Old runtime served from stale shell     | Service worker cache activation and registration tests                                                        |
| MicIcon / shared icon catalog 'mic'                                                              | General saved user icons                    | Preserve compatibility                                                    | Saved entity icon breaks                | Catalog unchanged; render regression                                                                          |
| shopping source='voice' and general task/shopping/calendar APIs                                  | Alice, historical records/offline entities  | Preserve                                                                  | User data or Alice break                | Shared manual/offline tests; no global source removal                                                         |
| AdminPage workspaceSettings default and forwarded training flag                                  | Workspace settings mutation                 | Remove obsolete default/forwarded field                                   | Confetti settings mutation breaks       | Session settings regression/typecheck                                                                         |

## Boundaries

Only apps/web changes. No production deployment, external writes, commits or personal device data clearing. Shared Android bridge contract coordinated as PlannerAppSettings.openSystemAppSettings().

## Implemented behavior

- Entire `features/voice-assistant` and `pages/voice-assistant-settings` directories removed, including runtime, recorder, native command polling, listeners/timers, confirmation and voice-only tests/fixtures.
- App mount and More link removed; `/voice-assistant/settings` now follows the existing catch-all `Navigate replace to=/today` in both personal/shared workspaces, covered by tests.
- Session logout retains push device unregister, auth token/session clearing, refresh and offline workspace cleanup; only obsolete voice plugin call removed.
- Current web session preferences, workspace optimistic update, Admin forwarding and test fixtures no longer contain voice/training flags.
- `openAndroidSystemAppSettings` moved into `shared/lib/native-app-settings.ts`, using real `PlannerAppSettings.openSystemAppSettings` bridge agreed with Android agent. Outside Android returns without native access; failures propagate to existing user-facing notification settings feedback and retry.
- Startup cleanup in `main.tsx` removes exactly `localStorage[planner.voiceAssistant.deviceSettings.v1]` and `sessionStorage[planner.webVoice.sessionId.v1]`; no marker, storage-wide clearing or database deletion. Each storage access is isolated against SecurityError, repeated execution is safe.
- Service worker runtime cache bumped v3→v4. Existing activation drops prior Planner shell/assets caches, retains the new shell cache and unrelated caches; it does not touch IndexedDB or offline mutation queues. Offline navigation to old settings URL serves the new shell, whose router redirects to Today.
- Shared MicIcon catalog entries, including saved `mic` and `svg:mic`, remain renderable (regression test). Common task/shopping/calendar operations and source='voice' records are untouched.

## Validation

- Original focused baseline: 7 suites, 50 tests PASS.
- `npm run test:web:run`: 134 suites total; 133 pass, 1 pre-existing failed suite (TodayPage); 1206 pass / 16 fail / 1222 tests total. Log `/tmp/planner-web-tests.log`.
- Pre-existing failure confirmed by running the exact original `git show HEAD:apps/web/src/pages/today/ui/TodayPage.test.tsx` as a temporary adjacent test, removed immediately after run: same 16 fail / 67 pass. Log `/tmp/planner-today-head-baseline.log`. Assertions search `Оценено N из N` (including provisional variant), while the daily load panel is collapsed (`aria-expanded=false`, only calm badge/open control). TodayPage implementation unchanged; test diff only removes voice flag from stub type/data. No unrelated fixes made.
- Final focused regression after edits: 18 suites / 168 tests PASS. Coverage includes cleanup, native settings errors/non-Android, notification UI/action/retry, old route, saved icon, auth/mobile refresh/logout, workspace/preferences mutation/rollback, offline sync, shopping, calendar, More and PWA update/offline shell. Log `/tmp/planner-web-final-focused.log`.
- `npx eslint apps/web`: PASS (`/tmp/planner-web-lint.log`).
- `npm run typecheck:web`: PASS (`/tmp/planner-web-typecheck.log`).
- `npx prettier --check apps/web`: PASS (`/tmp/planner-web-format.log`).
- `git diff --check -- apps/web`: PASS.
- Source search: no recording/runtime/feature imports left. Production voice mentions in web are limited to exact-key compatibility cleanup and its startup call. Test residuals assert retirement behavior. MicIcon remains a general icon.
- During tooling, system `/usr/bin/python3` failed due pre-existing Xcode/CoreDevice loader; bundled Python was used successfully, no repository/toolchain config change.

## Limits and handoff

- Root agent owns build/artifact checks and visual inspection, and is starting isolated E2E/DB setup; no duplicate local server started here.
- Physical Android system settings opening and actual installed upgrade behavior require native/emulator/device validation from Android/root work; web verifies bridge dispatch, error handling and platform gating, not OS display.
- PWA worker behavior is exercised in a VM with cache/storage spies; physical installed/offline PWA upgrade remains a release smoke checkpoint.
- No API, contracts, Android, root configuration/scripts/documentation, production, secrets or personal-device state modified by this agent.

## Changed files (including deletion/new files)

- `apps/web/public/sw.js`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/router/AppRouter.test.tsx`
- `apps/web/src/app/router/AppRouter.tsx`
- `apps/web/src/features/cleaning/lib/useCleaning.scope.test.tsx`
- `apps/web/src/features/cleaning/lib/useCleaning.test.tsx`
- `apps/web/src/features/self-care/lib/useSelfCare.test.tsx`
- `apps/web/src/features/session/lib/planner-session-cache.test.ts`
- `apps/web/src/features/session/lib/session-admin-hooks.test.tsx`
- `apps/web/src/features/session/lib/session-api.test.ts`
- `apps/web/src/features/session/lib/usePlannerSession.test.ts`
- `apps/web/src/features/session/lib/useSessionAuthController.ts`
- `apps/web/src/features/session/lib/useSessionFeatureReadiness.test.tsx`
- `apps/web/src/features/session/lib/useUserPreferences.ts`
- `apps/web/src/features/session/lib/useWorkspaceActions.test.tsx`
- `apps/web/src/features/session/lib/useWorkspaceParticipants.test.tsx`
- `apps/web/src/features/session/lib/useWorkspaceSettings.ts`
- `apps/web/src/features/session/ui/SessionProvider.test.tsx`
- `apps/web/src/features/session/ui/TimeZoneChangeBanner.test.tsx`
- `apps/web/src/features/shopping-list/lib/useShoppingList.hook.test.tsx`
- `apps/web/src/features/voice-assistant/index.ts`
- `apps/web/src/features/voice-assistant/lib/native-voice-assistant.ts`
- `apps/web/src/features/voice-assistant/lib/web-voice-command-api.test.ts`
- `apps/web/src/features/voice-assistant/lib/web-voice-command-api.ts`
- `apps/web/src/features/voice-assistant/lib/web-voice-recorder.ts`
- `apps/web/src/features/voice-assistant/model/locked-screen-scrubber.ts`
- `apps/web/src/features/voice-assistant/model/planner-action-executor.test.ts`
- `apps/web/src/features/voice-assistant/model/planner-action-executor.ts`
- `apps/web/src/features/voice-assistant/model/planner-intent-execution.test.ts`
- `apps/web/src/features/voice-assistant/model/planner-intent-execution.ts`
- `apps/web/src/features/voice-assistant/model/planner-intent-parser.test.ts`
- `apps/web/src/features/voice-assistant/model/shopping-list-text.ts`
- `apps/web/src/features/voice-assistant/model/useAndroidVoiceRuntime.ts`
- `apps/web/src/features/voice-assistant/model/useVoiceActionFlow.ts`
- `apps/web/src/features/voice-assistant/model/useVoiceMetrics.ts`
- `apps/web/src/features/voice-assistant/model/useWebVoiceInput.ts`
- `apps/web/src/features/voice-assistant/model/voice-action-agenda-handler.ts`
- `apps/web/src/features/voice-assistant/model/voice-action-create-task-handler.ts`
- `apps/web/src/features/voice-assistant/model/voice-action-factory.ts`
- `apps/web/src/features/voice-assistant/model/voice-action-formatting.ts`
- `apps/web/src/features/voice-assistant/model/voice-action-reschedule-handler.ts`
- `apps/web/src/features/voice-assistant/model/voice-action-shopping-handler.ts`
- `apps/web/src/features/voice-assistant/model/voice-action-shopping.ts`
- `apps/web/src/features/voice-assistant/model/voice-append-session.test.ts`
- `apps/web/src/features/voice-assistant/model/voice-append-session.ts`
- `apps/web/src/features/voice-assistant/model/voice-assistant-settings.ts`
- `apps/web/src/features/voice-assistant/model/voice-audio-upload-guard.test.ts`
- `apps/web/src/features/voice-assistant/model/voice-audio-upload-guard.ts`
- `apps/web/src/features/voice-assistant/model/voice-metrics.test.ts`
- `apps/web/src/features/voice-assistant/model/voice-metrics.ts`
- `apps/web/src/features/voice-assistant/model/voice-quality-report.test.ts`
- `apps/web/src/features/voice-assistant/model/voice-quality-report.ts`
- `apps/web/src/features/voice-assistant/model/voice-test-corpus.test.ts`
- `apps/web/src/features/voice-assistant/model/web-voice-input.test.ts`
- `apps/web/src/features/voice-assistant/model/web-voice-input.ts`
- `apps/web/src/features/voice-assistant/native.ts`
- `apps/web/src/features/voice-assistant/ui/LazyVoiceAssistant.test.tsx`
- `apps/web/src/features/voice-assistant/ui/LazyVoiceAssistant.tsx`
- `apps/web/src/features/voice-assistant/ui/LazyVoiceAssistantSettingsPanel.tsx`
- `apps/web/src/features/voice-assistant/ui/VoiceAssistant.module.css`
- `apps/web/src/features/voice-assistant/ui/VoiceAssistant.test.tsx`
- `apps/web/src/features/voice-assistant/ui/VoiceAssistant.tsx`
- `apps/web/src/features/voice-assistant/ui/VoiceAssistantSettingsPanel.module.css`
- `apps/web/src/features/voice-assistant/ui/VoiceAssistantSettingsPanel.test.tsx`
- `apps/web/src/features/voice-assistant/ui/VoiceAssistantSettingsPanel.tsx`
- `apps/web/src/features/voice-assistant/ui/VoiceConfirmationCard.test.tsx`
- `apps/web/src/features/voice-assistant/ui/VoiceConfirmationCard.tsx`
- `apps/web/src/main.tsx`
- `apps/web/src/pages/admin/ui/AdminPage.tsx`
- `apps/web/src/pages/calendar/ui/CalendarPage.test.tsx`
- `apps/web/src/pages/more/ui/MorePage.test.tsx`
- `apps/web/src/pages/more/ui/MorePage.tsx`
- `apps/web/src/pages/notifications-settings/ui/NotificationsSettingsPage.test.tsx`
- `apps/web/src/pages/notifications-settings/ui/NotificationsSettingsPage.tsx`
- `apps/web/src/pages/today/ui/TodayPage.test.tsx`
- `apps/web/src/pages/voice-assistant-settings/index.ts`
- `apps/web/src/pages/voice-assistant-settings/ui/VoiceAssistantSettingsPage.module.css`
- `apps/web/src/pages/voice-assistant-settings/ui/VoiceAssistantSettingsPage.tsx`
- `apps/web/src/shared/config/routes.test.ts`
- `apps/web/src/shared/config/routes.ts`
- `apps/web/src/shared/lib/observability/client-events.ts`
- `apps/web/src/shared/time/time.test.ts`
- `apps/web/src/shared/ui/Icon/IconChoicePicker.test.tsx`
- `apps/web/src/shared/lib/cleanup-retired-voice-storage.test.ts`
- `apps/web/src/shared/lib/cleanup-retired-voice-storage.ts`
- `apps/web/src/shared/lib/native-app-settings.test.ts`
- `apps/web/src/shared/lib/native-app-settings.ts`
- `apps/web/src/shared/lib/pwa/service-worker.test.ts`

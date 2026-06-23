# Time System v1 post-implementation audit

Date: 2026-06-23

Primary guard:

```sh
npm run time:guard
```

Audit search:

```sh
rg -n "\bnew Date\(|\bDate\.parse\(|toISOString\(\)\.slice\(0,\s*10\)|\.getFullYear\(|\.getMonth\(|\.getDate\(" apps packages --glob '!**/*.test.*' --glob '!**/dist/**' --glob '!**/node_modules/**'
```

## Summary

The urgent Time System leftovers from the previous audit are closed.

- UI `todayKey`/`tomorrowKey` call sites now receive planner-zone dates from `usePlannerTimeZone` + `getTodayDate`/`addDateDays`.
- Today, calendar month grids, cleaning weekday fallbacks, self-care ranges, habits, and task recurrence date-only arithmetic use shared time helpers instead of raw JS `Date` calendar math.
- AI today/week/search/overload/self-care context resolves default day and week boundaries from the explicit planner timezone.
- PostgreSQL `date` fields now serialize through `serializeDateOnly(value: string | Date | null): string | null`.
- `npm run time:guard` fails on forbidden planner-date patterns in production code.

Current guard status: no forbidden production matches.

## Safe Instant Scenarios

These direct `Date` usages remain acceptable because they create, serialize, or compare absolute instants such as `createdAt`, `updatedAt`, deletion markers, tokens, audit, outbox, notification sends, cache expiry, or operational metrics.

- `apps/api/src/modules/tasks/*`, `habits/*`, `self-care/*`, `cleaning/*`, `daily-plans/*`, `life-spheres/*`, `task-templates/*`, `chaos-inbox/*`: repository metadata and mutation instants.
- `apps/api/src/modules/session/*`, `auth/*`, `mcp-haotika/*`, `apps/web/src/features/session/*`: token/session expiry and invite/member audit instants.
- `apps/api/src/modules/outbox/*`, `task-reminders/*`, `self-care-reminders/*`, `push-notifications/*`: processed/sent/registration instants.
- `apps/web/src/features/*/offline-*store.ts`, `planner-records.ts`, `planner-mutations.ts`: offline sync mutation instants.
- `apps/api/src/bootstrap/observability.ts`, `build-app.ts`, `apps/web/src/shared/lib/observability/client-events.ts`: operational timestamps.
- `apps/api/src/modules/voice/voice.service.ts`: `Date.parse(security.issuedAt)` validates an issued-at instant, not a planner date.

Recommended cleanup: these can later move to a `nowUtc()` helper so direct `new Date()` is confined even more tightly, but they do not currently affect planner-date behavior.

## Time-Layer Internals

The following files may still contain raw `Date`/`Intl` internals because they are the shared abstraction or parser layers that receive explicit timezone context.

- `packages/contracts/src/time/*`
- `apps/web/src/shared/time/*`
- `packages/contracts/src/planner-intent.ts`
- `apps/api/src/modules/alice/alice-command-parser.ts`
- `apps/api/src/modules/alice/alice.routes.ts`

Parser note: `planner-intent` and Alice still own some duplicate date math internally. They are context-aware enough for current behavior, but should eventually delegate date-only arithmetic to the shared time helpers.

## Guarded Patterns

`scripts/time-system-guard.mjs` scans production files under `apps` and `packages`, excluding tests, build output, and the shared time-layer. It fails on:

- `toISOString().slice(0, 10)`
- `new Date(...T00:00...)`
- `new Date(...T12:00...)`
- local `.getFullYear()`, `.getMonth()`, `.getDate()`

The guard is wired into `npm run lint` and is also available as `npm run time:guard`.

## Fixed In This Pass

- `apps/web/src/entities/task/ui/TaskCard.tsx`, `TaskEditDialog.tsx`, `TaskSection.tsx`: no internal browser-local today/tomorrow calculation.
- `apps/web/src/pages/today/ui/TodayPage.tsx`, `pages/calendar/*`, `pages/cleaning/*`, `pages/self-care/*`, `pages/spheres/*`, `widgets/sidebar/*`: planner-zone date keys and shared date-only arithmetic.
- `apps/api/src/modules/ai-context/*`: default today/week/range resolution now uses explicit planner timezone and shared date helpers.
- `apps/api/src/modules/*`: pg date serializers for task, daily plan, template, chaos inbox, cleaning, habits, self-care, and life-sphere date-only fields use `serializeDateOnly`.
- `apps/api/src/modules/cleaning/cleaning.shared.ts`, `habits/habit.shared.ts`, `self-care/self-care.recurrence.ts`, `tasks/task.service.ts`: date-only recurrence and range math no longer goes through UTC midnight/noon.
- `apps/web/src/features/habits/lib/habit-projection-model.ts` and self-care schedule helpers: weekday/date shifts moved to shared helpers.
- Regression coverage added for timezone boundary today, calendar grid stability, AI context default day, pg date serialization, DST conversion, and Astrakhan to Amsterdam planner-zone switching.

## Remaining Follow-Up

- Move Alice and `planner-intent` duplicate parser arithmetic fully onto shared date-only helpers.
- Consider a stricter future guard that also blocks direct instant `new Date()` outside explicit instant utilities once `nowUtc()` exists.
- Thread planner timezone into any remaining appointment datetime creation UX where the current code intentionally builds an absolute instant from local user input.

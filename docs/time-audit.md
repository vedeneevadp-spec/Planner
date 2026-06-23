# Time System v1 audit

Date: 2026-06-23

## Summary

The codebase currently mixes at least four time semantics:

- Instant timestamps: `created_at`, `updated_at`, `completed_at`, `deleted_at`, auth token expiry, outbox processing, reminder sending.
- Date-only planner dates: task `planned_on`, `due_on`, daily plans, habit entries, cleaning state/history dates, self-care scheduled days.
- Fixed-zone date-times: task `planned_on` plus `task_time_blocks.starts_at/ends_at`, self-care appointments, reminder due times.
- Floating local routines: task recurrence/routine, habits, cleaning rules, self-care schedule rules.

The risky part is that several fixed-zone and date-only operations currently pass through `Date`, UTC midnight, or the browser/server default timezone. A search for direct date/time primitives in production source returned 442 matches across web, API, and contracts.

## Critical findings

### Tasks

- `packages/contracts/src/task.ts`
  - `taskRecurrenceInputSchema` defaults `startDate` with `new Date().toISOString().slice(0, 10)`.
  - Risk: recurrence start date is UTC-based, not planner-zone based.

- `apps/api/src/modules/tasks/task.shared.ts`
  - `normalizeTaskRecurrence` defaults recurrence start date with local helper `getDateKey(new Date())`, whose implementation uses `toISOString().slice(0, 10)`.
  - `buildTimestampFromDateAndTime(date, time)` creates `${date}T${time}:00.000Z`.
  - Risk: `YYYY-MM-DD HH:mm` is interpreted as UTC instead of the user's planner-zone.

- `apps/api/src/modules/tasks/task.repository.postgres.ts`
  - Create/update/schedule/transfer paths call `buildTimestampFromDateAndTime` for task time blocks.
  - Risk: a task entered as `2026-06-25 18:00 Europe/Astrakhan` is stored as `2026-06-25T18:00Z`, which displays as a different local time.

- `apps/api/src/modules/tasks/task.repository.postgres.mutations.ts`
  - `insertPrimaryTimeBlock` writes `timezone: 'UTC'`.
  - Risk: original event zone is lost for all manually scheduled tasks.

- `apps/api/src/modules/tasks/task.repository.postgres.mapper.ts`
  - `plannedStartTime` and `plannedEndTime` are extracted from stored timestamps with UTC slicing.
  - Risk: local times are only stable because writes forced them into UTC-shaped timestamps; once zones are real, mapping must preserve local time explicitly.

- `apps/api/src/modules/tasks/task.service.ts`
  - Recurrence completion uses `getDateKeyInTimeZone`, which is good when `clientTimeZone` is present.
  - Fallback path uses `toISOString().slice(0, 10)`.
  - Risk: non-route callers and missing client timezone keep old UTC behavior.

### Today and calendar

- `apps/web/src/pages/today/ui/TodayPage.tsx`
  - Computes `todayKey` / `tomorrowKey` with `getDateKey(new Date())` and `addDays(new Date(), 1)`.
  - Risk: browser timezone decides the Today view.

- `apps/web/src/pages/calendar/lib/calendar-load.ts`
  - Builds calendar grids with `new Date(year, month - 1, day, 12)`, `getDate`, `getMonth`, `getFullYear`.
  - Risk: calendar math is tied to browser timezone. Date-only strings may shift at DST boundaries or on devices in a different zone.

- `apps/web/src/pages/calendar/ui/CalendarPage.tsx`
  - Uses client timezone label from device offset and `resolveClientTimeZone()`.
  - Risk: the UI implies device timezone, not planner-zone, and there is no explicit planner-zone selection.

### Cleaning

- `apps/web/src/features/cleaning/lib/useCleaning.ts`
  - Defaults date to `getDateKey(new Date())`.

- `apps/api/src/modules/cleaning/cleaning.routes.ts`
  - Defaults query date with `getDateKey(new Date())`.

- `apps/api/src/modules/cleaning/cleaning.shared.ts`
  - Uses `toISOString().slice(0, 10)` and date math through `new Date(`${dateKey}T12:00:00.000Z`)`.
  - Risk: cleaning "today" can differ between browser and server. Cleaning dates should be date-only in planner-zone.

### Habits and self-care

- `apps/web/src/features/habits/lib/useHabits.ts`, `apps/web/src/pages/habits/ui/HabitsPage.tsx`
  - Defaults "today" with device-local `new Date`.

- `apps/api/src/modules/habits/habit.repository.postgres.ts`, `apps/api/src/modules/habits/habit.shared.ts`
  - Default habit start/today uses server-side `new Date`.

- `apps/web/src/pages/self-care/ui/SelfCarePage.tsx`, `apps/web/src/features/self-care/lib/useSelfCare.ts`
  - Defaults ranges with device-local `new Date`.

- `apps/api/src/modules/self-care/self-care.routes.ts`, `apps/api/src/modules/self-care/self-care.shared.ts`
  - Defaults date/startDate with server-side `new Date`.
  - Some self-care reminder logic already stores `timezone` and calculates reminder instants explicitly, but date-only defaults still need planner-zone.

### Voice

- `packages/contracts/src/planner-intent.ts`
  - Parser context already has `timezone` and `now`, and relative phrases use `formatDateKeyInTimezone(context.now, context.timezone)`.
  - This is the best current pattern.
  - Remaining risk: the default timezone is `Europe/Moscow`, while the planner-zone rules require user/workspace/device resolution and only emergency fallback to `UTC`.

- `apps/web/src/features/voice-assistant/model/useVoiceActionFlow.ts`
  - Sends `resolveVoiceClientTimeZone()` and falls back to `UTC` in one command path.
  - Risk: device timezone is used directly instead of explicit planner-zone.

### API and storage contracts

- Current task API returns legacy fields: `plannedDate`, `plannedStartTime`, `plannedEndTime`, `dueDate`.
- It does not return a structured `schedule` object with `kind`.
- Current task DB columns:
  - `planned_on date`: date-only calendar date.
  - `due_on date`: date-only due date.
  - `due_at timestamptz`: instant due time, currently unused for task schedules.
  - `task_time_blocks.starts_at/ends_at timestamptz`: timed schedule, but currently built from local date/time as if UTC.
  - `task_time_blocks.timezone`: exists but currently written as `UTC` for manual blocks.

## Current UTC-midnight / UTC-local risks

- `new Date().toISOString().slice(0, 10)` appears in contracts, API repositories, cleaning, habits, self-care, daily plans, life spheres, scripts, and tests.
- `buildTimestampFromDateAndTime` turns `YYYY-MM-DD` + `HH:mm` into a UTC instant without a timezone.
- Serializers that receive PostgreSQL `date` as a `Date` call `toISOString().slice(0, 10)`. This is safe only if the driver returns midnight UTC; it should be replaced by date-only serialization that does not reinterpret local dates.

## Classification of existing fields

- `created_at`, `updated_at`, `deleted_at`, `completed_at`, auth `expires_at`, outbox `processed_at`, reminders `sent_at`: instant, UTC/timestamptz.
- `planned_on`, `due_on`, daily plan `date`, habit entry `date`, cleaning history `date`, cleaning `next_due_at`, self-care `scheduled_for`, `start_date`, `end_date`: date-only.
- `task_time_blocks.starts_at/ends_at`, self-care appointment `starts_at/ends_at`, reminder `due_at/reminder_at`: fixed-zone datetime or occurrence instant. They require an IANA timezone next to the local date/time source.
- Recurrence metadata and routine/habit/self-care repeating rules: floating local time unless explicitly tied to a fixed event timezone.

## Immediate remediation target

1. Introduce shared `TimeService` and use it for planner-zone day keys and fixed-zone conversion.
2. Add task `time_kind`, `local_date`, `local_time`, `time_zone`, `starts_at_utc`, and recurrence timezone columns.
3. Keep legacy `plannedDate/plannedStartTime` while adding structured `schedule`.
4. Stop writing timed tasks as UTC local strings and stop writing `task_time_blocks.timezone = 'UTC'` when a client/planner timezone is available.
5. Change Today/Calendar/Cleaning/Self-care frontend defaults to planner-zone helpers instead of raw `new Date()`.

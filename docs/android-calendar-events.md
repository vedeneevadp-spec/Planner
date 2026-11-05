# Android calendar event import

Chaotika handles the Android actions `ACTION_INSERT` and
`ACTION_INSERT_OR_EDIT` for calendar event MIME types. This makes it eligible
for the system app chooser used by compatible “Add event” suggestions in
messages and notifications. No SMS, notification-listener or calendar access
permission is requested.

## User flow

Selecting Chaotika opens the existing task form with the fields supplied by
the sending app. The task is saved only after the user presses “Добавить”.
All existing settings remain available.

- Title and description retain their supplied text. Location is added to the
  note because tasks do not have a separate address field.
- A timed event uses the supplied instant in the planner's time zone. All-day
  events use their UTC date without inventing a start time.
- A same-day end time fills “Финиш”. A timed event ending on another day keeps
  its end date and time in the note; tasks currently have one planned day.
- Missing or malformed dates leave the task flexible. Missing titles remain
  empty for the user to fill in.
- An already-open dialog is preserved. Incoming events wait until it closes.
- The ordinary Today task composer stays mounted while foreground refresh
  temporarily reloads task data, so opening another app does not erase its draft.
- If sign-in is required, the incoming event waits for the planner to load.

## Android integration

`MainActivity` captures cold and warm intents. `PlannerCalendarEventStore`
keeps a bounded queue of 20 drafts in the existing encrypted native storage;
only supported fields are retained and their lengths are bounded. Intent
contents are never logged. Launches replayed from Android history are ignored.
Capacitor replays the launch intent through `onNewIntent` while creating its
bridge; that callback is suppressed for capture so a cold launch or activity
recreation cannot enqueue the same event twice.

`PlannerCalendarEventsPlugin` exposes non-destructive reads and acknowledgment
by request id. A draft is acknowledged after successful save or explicit close,
not when React first reads it. This keeps it across startup, sign-in and effect
remounts. Later incoming events do not overwrite an open draft. When the queue
is full, its oldest entry is dropped.

The coordinator loads only on Android. Web/PWA startup does not preload its
native code. There is no API or database migration and no new dependency.

## Compatibility and validation

The sending app determines which fields reach Chaotika. Apps that explicitly
target another calendar, or use their own private action, can bypass Android's
chooser. The implementation does not read messages or recognize screenshots.
Real Samsung/One UI smart suggestions must still be checked on a physical phone;
standard-intent emulator checks do not prove a particular sender's behavior.

Model tests cover dates, time zones and missing fields. Form/coordinator tests
cover confirmation, cancellation, authentication/loading, repeated effects and
preserving another open form, including a transient Today loading state. The
browser E2E uses the real task API against an
isolated local database. Android instrumented tests exercise intent resolution,
extra parsing, the encrypted queue, cold launch and activity recreation on an
emulator. Full installed-app checks need the existing Firebase configuration
even for a debug APK, because signing in starts push registration.

References:

- [Android calendar intents](https://developer.android.com/guide/components/intents-common#Calendar)
- [AOSP text-classifier calendar action](https://android.googlesource.com/platform/prebuilts/fullsdk/sources/android-28/+/refs/heads/androidx-activity-release/android/view/textclassifier/TextClassifierImpl.java)

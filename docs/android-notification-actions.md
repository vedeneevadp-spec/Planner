# Android task reminder actions

Android 1.1.27 / build 35 adds `Готово` and `Через 15 минут` to task reminders.
The ordinary notification tap opens the task in its workspace. No settings or
additional notification permissions are required. Other notification types,
including self-care reminders that may require measurements or ritual steps,
retain their existing behavior.

## Delivery and compatibility

The server partitions registered devices by their existing `appVersion` field.
Android versions starting at 1.1.27 receive high-priority, data-only task reminders
with protocol version 1 and the recipient account id. Older/unknown versions get
the unchanged FCM notification payload. No database migration is required.

`PlannerMessagingService` replaces Capacitor's manifest messaging service while
inheriting token registration and forwarding ordinary messages to Capacitor.
Task notifications are rendered natively, including when the WebView is closed.
Firebase Messaging was already included by Capacitor; its existing version is
now declared once in `android/variables.gradle` for both consumers.

FCM notification payloads are rendered by the system in the background; native
actions therefore require data messages. See the official
[FCM delivery behavior](https://firebase.google.com/docs/cloud-messaging/android/receive-messages).

## Completion

An immutable, explicit PendingIntent invokes a non-exported receiver. Before
acknowledging the tap, the receiver commits an encrypted, account-scoped pending
action. A persisted JobScheduler job uses the existing secure native session,
refresh rotation and configured API origin. It fetches the task, stores its
version, and calls the existing status endpoint with `expectedVersion`.

- Repeat taps are ignored while pending; an already-completed task is a no-op.
- Deleted tasks dismiss the stale reminder. Archived/review tasks and version
  conflicts show a notice to open the task instead of overwriting newer data.
- Network/temporary server failures retain the pending action and retry.
- The pending notification describes the unconfirmed state; it disappears only
  after success or after discovering that the task no longer exists.
- Logout clears reminders, alarms and pending actions. Account checks before
  sending prevent an old notification from running as another signed-in user.
- Successful completion refreshes the active web task/search queries and widgets.

## Snooze

Snooze stores a wake time 15 minutes ahead and schedules a local, inexact
`AlarmManager.setAndAllowWhileIdle` alarm. It does not edit the task date or
require connectivity. The repeated notification uses the task title rather than
the original, now-stale “starts in …” text. Snoozes are restored after reboot and
app update. Android power restrictions can delay an inexact alarm; no special
exact-alarm permission is requested. Explicit force-stop still prevents Android
from running background components until the user opens the app again.

## Validation and release

Focused API tests cover old/new device delivery, payloads, invalid tokens and
partial delivery failures. JVM tests cover payload validation, persisted state,
account isolation and completion decisions. Instrumented Android tests exercise
real notifications, PendingIntents, encrypted storage and background HTTP calls
against an isolated local test API; they do not contact production accounts.

Ship the server change and the updated APK to enable the feature. The version
gate allows either rollout order without dropping older clients' reminders.

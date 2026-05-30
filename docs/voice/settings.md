# Voice Assistant Settings

## Responsibility

The settings layer controls availability and local runtime behavior for the existing voice assistant. It does not add intents, change parsing or action execution, enable auto-confirm, connect TTS, or expose STT/LLM provider choices.

## Role Gate

Voice settings are available only for `owner` and `test` application roles. `admin`, `user`, and `guest` do not receive active controls, and backend voice routes remain guarded by the same `canUseVoiceAssistant` policy.

The `test` role only grants access to rollout features. It does not grant admin rights.

## Supported Settings

- `voiceAssistantEnabled`: user-level master switch stored in user preferences.
- `androidWakeWordEnabled`: device-local Android wake word switch.
- `backgroundWakeWordEnabled`: device-local Android background listening switch.
- `voiceCuesEnabled`: device-local Android local cue switch.
- `wakeWordSensitivity`: read-only Android model threshold from the wake-word
  manifest.
- `wakeWordTrainingModeEnabled`: workspace-level review mode for wake-word evaluation.

The voice assistant settings live on the dedicated `/voice-assistant/settings` page. The "More" page links to that page after the theme control and does not embed the full settings panel.
The workspace training-mode switch is editable by `owner` only; `test` can use rollout voice controls but does not receive workspace-admin rights.

Readonly v1 values:

- `wakePhrase`: `Хаотика`
- `confirmationMode`: `confirmation_first`

Recognition language is not configurable in settings. Runtime speech recognition uses Russian (`ru-RU`) by default.

## Platform Differences

Android supports wake word, background wake word, local static voice cues, permission status, and foreground-service status through the Capacitor native plugin.

Web remains push-to-talk only. Web does not expose wake word, background listening, or voice cues controls.

## Permissions

The settings UI shows microphone permission, notification permission, foreground service status, and wake model status. Background wake word is blocked until:

- voice assistant is enabled;
- wake word is enabled;
- wake model status is `ready`;
- microphone permission is `granted`;
- notification permission is `granted`.

System app settings and battery optimization settings are exposed as native Android actions.

## Storage Strategy

User/server storage:

- `voiceAssistantEnabled`

Workspace/server storage:

- `wakeWordTrainingModeEnabled`

Device-local storage:

- `androidWakeWordEnabled`
- `backgroundWakeWordEnabled`
- `voiceCuesEnabled`

`wakeWordSensitivity` is intentionally not stored as a device override during
the closed training rollout. Runtime uses the threshold from
`wakewords/haotika_manifest.json`, and stale local sensitivity values are
ignored so collected false accepts / false rejects stay comparable.

Derived runtime state is not stored as a user setting:

- microphone permission
- notification permission
- foreground service status
- wake model status

## Intentionally Not Configurable

- wake phrase selection;
- custom wake phrase;
- auto-confirm toggle;
- TTS or cloud TTS;
- STT provider selector;
- LLM provider selector;
- debug metrics for normal users;
- audio sample storage without a separate opt-in.

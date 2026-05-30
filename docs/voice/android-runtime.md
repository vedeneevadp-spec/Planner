# Android Voice Runtime

Android runtime отвечает только за wake word, foreground service, static cues,
короткую запись команды и bridge в WebView. Parser/action behavior не меняется.

## Lifecycle

```text
manual enable from app
-> foreground microphone service
-> local wake-word engine
-> WakeWordDetected
-> pause wake engine
-> play static cue "Слушаю" + overlay
-> start command recorder after cue guard
-> local validation
-> backend /api/voice/command
-> WebView confirmation UI
-> resume wake-word listening if still enabled
```

Android v1 uses `START_NOT_STICKY`: if the OS kills the service, the app records
the degraded/stopped state and waits for the user to start listening manually.

## Statuses

```ts
type AndroidVoiceRuntimeStatus =
  | 'disabled'
  | 'starting'
  | 'running_foreground'
  | 'listening_wake_word'
  | 'paused_for_command'
  | 'playing_listening_cue'
  | 'recording_command'
  | 'stopping'
  | 'stopped'
  | 'blocked'
```

## Errors

```ts
type AndroidVoiceRuntimeError =
  | 'missing_microphone_permission'
  | 'missing_notification_permission'
  | 'missing_wake_model'
  | 'foreground_service_not_allowed'
  | 'battery_restricted'
  | 'security_exception'
  | 'wake_engine_error'
  | 'audio_cue_error'
  | 'recorder_error'
```

## Metrics

Safe runtime metrics:

```text
wake_service_started
wake_service_stopped
wake_service_start_failed
wake_service_runtime_minutes
wake_engine_started
wake_engine_stopped
wake_engine_error
wake_detection_latency_ms
command_recorder_start_latency_ms
audio_cue_duration_ms
audio_cue_to_recorder_delay_ms
battery_sample
cpu_sample
memory_sample
service_killed_or_restarted
graceful_degradation_used
```

Metrics must not contain raw audio, transcript, task titles, shopping item names,
agenda content, candidate titles, LLM prompts, or STT provider responses.

## Graceful Degradation

Missing wake model:

```text
wake word disabled
background wake word disabled
push-to-talk fallback available
manual text input available
runtime error: missing_wake_model
```

Microphone permission revoked:

```text
service stopped
wake engine stopped
recorder stopped
buffers cleared
push-to-talk blocked until permission is restored
manual text input available
runtime error: missing_microphone_permission
```

Notification permission revoked:

```text
background wake word disabled
foreground/background service start blocked
in-app push-to-talk remains available if microphone permission is granted
runtime error: missing_notification_permission
```

Foreground service startup failure:

```text
SecurityException -> security_exception
IllegalStateException/runtime service-start failure -> foreground_service_not_allowed
no crash
background wake word disabled
push-to-talk remains available if microphone permission is granted
```

Service killed by OS:

```text
no aggressive restart
runtime status stopped/degraded
service_killed_or_restarted metric recorded when detectable
user starts wake listening manually from the app
```

## Reboot Behavior

No boot receiver starts microphone listening in v1. After reboot, wake-word
listening stays off until the user opens the app and starts it manually.
Push-to-talk remains available when microphone permission is granted.

## Cue Timing

`Слушаю` is a bundled local static cue, not TTS. The command recorder starts only
after cue completion and a short guard delay. Runtime records:

```text
audio_cue_duration_ms
audio_cue_to_recorder_delay_ms
command_recorder_start_latency_ms
```

This keeps the cue out of the STT command clip. If local validation does not find
a command after the cue, the clip is blocked and is not uploaded.

## Buffers

Wake-word ring buffers are bounded by the model input window and the short review
window. Buffers are cleared on stop, wake-engine error, permission revoke, service
destroy, and command completion. Pending wake training samples stay in memory and
are written only after explicit training collection consent.

## Doze, Screen-Off, And Vendor Restrictions

Expected v1 behavior:

```text
Doze/screen off may delay app work but foreground notification should keep an active service visible.
Battery Saver or vendor restrictions may still stop microphone work.
The app must surface stopped/blocked status instead of auto-restarting in a loop.
Users can open system app settings and battery optimization settings from voice settings.
```

Vendor-specific battery managers are not bypassed. The manual test should record
device vendor, Android version, battery saver state, and whether the system shows
the foreground notification continuously.

## Debug UI

Voice settings for `owner` and `test` show:

```text
Android voice runtime
Status
Wake model
Foreground service
Last error
Runtime
Battery sample
CPU sample
Memory sample
Push-to-talk fallback
```

## Manual Test Matrix

```text
- foreground app;
- background + notification;
- locked screen;
- screen off;
- no network;
- microphone permission revoke;
- notification permission revoke;
- missing model;
- foreground service SecurityException;
- service killed by OS;
- reboot;
- battery saver enabled;
- vendor battery restriction;
- "Слушаю" cue timing;
- push-to-talk fallback.
```

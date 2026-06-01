# Android Voice Runtime

Android runtime отвечает только за wake word, foreground service, локальные
non-verbal audio signals, короткую запись команды и bridge в WebView.
Parser/action behavior не меняется.

## Lifecycle

```text
manual enable from app
-> foreground microphone service
-> local wake-word engine
-> WakeWordDetected
-> pause wake engine
-> play short start signal + haptic + overlay "Слушаю"
-> start command recorder after signal guard
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
  | 'playing_start_signal'
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
  | 'unsupported_wake_model_input'
  | 'foreground_service_not_allowed'
  | 'battery_restricted'
  | 'security_exception'
  | 'wake_engine_error'
  | 'audio_signal_error'
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
wake_detected_to_recorder_start_ms
command_recorder_start_latency_ms
start_signal_duration_ms
audio_signal_to_recorder_delay_ms
audio_signal_start_played
audio_signal_success_played
audio_signal_suppressed
audio_signal_error
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

## Audio Signal Timing

Start signal is a bundled local non-verbal signal, not TTS. Android plays it
through `SoundPool`; `MediaPlayer` is not used for these short signals. The
command recorder starts only after signal completion and a short guard delay.
Runtime targets:

```text
signalDurationMs: 40-100
guardDelayMs: 30-50
wake_detected_to_recorder_start_ms: <= 150-200
```

Runtime records:

```text
start_signal_duration_ms
audio_signal_to_recorder_delay_ms
command_recorder_start_latency_ms
wake_detected_to_recorder_start_ms
```

This keeps the start signal out of the STT command clip. If local validation
does not find a command after the signal, the clip is blocked and is not
uploaded.

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
- start signal timing;
- push-to-talk fallback.
```

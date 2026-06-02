# Web Voice Mode v1

Web voice input is push-to-talk only. It does not implement wake word,
background listening, audio signals, TTS, cloud TTS, or client-side STT/LLM
provider keys.

## Flow

```text
mic button click
-> getUserMedia
-> MediaRecorder
-> Web Audio PCM capture
-> local validation
-> POST /api/voice/command
-> transcript + PlannerIntent
-> VoiceConfirmationCard
```

The browser path uses `MediaRecorder` as the capture lifecycle, but the web
client does not upload the browser `audio/webm` / opus blob in v1. The uploaded
payload is 16 kHz mono PCM captured through Web Audio and sent to the existing
backend STT endpoint. `SpeechRecognition` is not the production primary path
because browser support is limited.

## State Machine

```ts
type WebVoiceInputState =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'validating_audio'
  | 'uploading'
  | 'recognizing'
  | 'parsing'
  | 'ready_for_confirmation'
  | 'needs_repeat'
  | 'permission_denied'
  | 'unsupported'
  | 'error'
```

Visual labels:

```text
idle -> Нажми микрофон
requesting_permission -> Запрашиваю доступ к микрофону
listening -> Слушаю
validating_audio -> Проверяю запись
uploading/recognizing/parsing -> Распознаю
needs_repeat -> Нужно повторить
permission_denied -> Нет доступа к микрофону
unsupported -> Голосовой ввод недоступен в этом браузере
error -> Не удалось распознать
```

## Browser Fallback

Web voice requires:

- secure context: HTTPS or localhost;
- `navigator.mediaDevices.getUserMedia`;
- `MediaRecorder`;
- `AudioContext` for PCM extraction and local validation.

If any required browser capability is missing, the UI shows:

```text
Голосовой ввод недоступен в этом браузере.
Можно ввести задачу вручную.
```

The main planner UI and manual task input remain available.

## Permission Errors

Browser capture errors are shown as visual statuses:

```text
NotAllowedError -> Нет доступа к микрофону
NotFoundError -> Микрофон не найден
NotReadableError -> Микрофон занят другим приложением
SecurityError / insecure context -> Открой приложение через HTTPS
AbortError -> Запись прервана
```

## Local Validation

Before upload, web validates:

```text
minDurationMs: 500
maxDurationMs: 15000
not empty
not silent
not too quiet
has voice activity
explicit user action required
```

If validation fails, audio is not uploaded. The UI moves to `needs_repeat` and
keeps retry and manual input actions available.

## Backend Upload

Web v1 upload format is fixed:

```text
payload: pcm_s16le
sampleRateHertz: 16000
channelCount: 1
bitsPerSample: 16
byteOrder: little_endian
content-type: audio/l16
```

`MediaRecorder` may expose an `audio/webm;codecs=opus` recording container in
many browsers, but that blob is not part of the v1 `/api/voice/command`
contract. Backend webm/opus normalization is a separate future option and would
require explicitly allowing `webm_opus` only for `source = web_push_to_talk`.

Endpoint:

```http
POST /api/voice/command
Content-Type: audio/l16
x-stt-source: web_push_to_talk
x-voice-request-id: <uuid>
x-voice-session-id: <web voice session id>
x-voice-issued-at: <ISO date-time>
```

The web client sends the same PCM metadata headers as Android push-to-talk:

```text
x-audio-sample-rate: 16000
x-audio-channel-count: 1
x-audio-bits-per-sample: 16
x-audio-byte-order: little_endian
x-audio-encoding: pcm_s16le
x-audio-duration-ms: <duration>
```

Backend response is parsed with `voiceCommandResponseSchema`; the returned
`transcript + PlannerIntent` is passed to the same `VoiceConfirmationCard`.

## Privacy And Metrics

Web v1 requires an explicit click/tap before recording. It does not store raw
audio and does not include raw audio, transcript, task titles, shopping item
names, or preview contents in client metrics.

Client metrics:

```text
web_voice_started
web_voice_unsupported
web_voice_permission_denied
web_voice_recording_cancelled
web_voice_recording_stopped
web_voice_local_validation_failed
web_voice_upload_started
web_voice_upload_completed
web_voice_upload_error
web_voice_timeout
```

Metric details are limited to safe operational fields such as `source`, `state`,
`stage`, `durationMs`, `byteLength`, provider name, and status/error codes. They
must not include transcript, raw text, task titles, shopping item names, agenda
content, candidate titles, audio bytes, or audio blobs.

## Browser Compatibility Checklist

Manual browser checks before rollout:

- Chrome desktop;
- Chrome Android;
- Safari macOS;
- Safari iOS, if the web app is expected to support iOS browser voice input;
- Firefox desktop.

Cases to verify:

- unsupported state for insecure context;
- unsupported state when `getUserMedia` or `MediaRecorder` is missing;
- permission denied, microphone not found, and microphone busy messages;
- too short recording is not uploaded;
- silent recording is not uploaded;
- too quiet recording is not uploaded;
- cancel does not upload audio;
- max recording timeout stops capture and proceeds to validation;
- backend request timeout resets the visual state;
- manual input and the main planner UI remain available.

## Out Of Scope

```text
Web wake word
Browser background listening
Web audio signals
Web TTS/cloud TTS
SpeechRecognition as production primary
STT/LLM provider keys in the web bundle
Raw audio persistence
Blocking the planner UI on recognition errors
```

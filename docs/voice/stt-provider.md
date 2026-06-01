# STT provider

Документ фиксирует пункт 3 голосового помощника: реальный STT после локального
wake word `Хаотика`.

## Решение

```text
Хаотика detected locally
→ record short command locally
→ local validation
→ upload only valid short clip
→ backend Yandex SpeechKit
→ transcript + PlannerIntent
→ visual confirmation UI
→ user confirms / edits / cancels
```

Mode: `HYBRID-ready`.

Primary production STT: server-side provider through backend.

Primary backend provider: Yandex SpeechKit.

First implementation: short-clip upload, not streaming.

Offline fallback: architecture only. `LocalSpeechToTextServiceStub` is a
placeholder for later Sherpa-ONNX or Vosk integration. Full offline STT model
is not part of пункт 3.

`StubSpeechToTextService` is not production provider. It may stay only for
tests/dev.

Production rollout gate:

- enabled for global `appRole = owner`;
- enabled for global `appRole = test`;
- disabled for `admin`, `user`, and `guest`.

`test` is a regular user role with the voice feature enabled. It does not grant
admin capabilities or extra workspace permissions.

## Android flow

Wake-word mode:

```text
WakeWordDetected
→ pause WakeWordEngine
→ play activation sound
→ vibrate
→ show overlay “Слушаю”
→ CommandAudioRecorder starts recording
→ stop by silence or maxDuration
→ local audio validation
→ SpeechToTextService.transcribe()
→ transcript + PlannerIntent
→ show visual confirmation UI
→ user confirms / edits / cancels
→ execute action if confirmed or auto-confirmed
→ resume WakeWordEngine
```

До `WakeWordDetected` аудио не отправляется на server-side STT.

Push-to-talk mode:

```text
User taps microphone button
→ source = android_push_to_talk
→ show overlay “Слушаю”
→ CommandAudioRecorder starts recording
→ stop by silence or maxDuration
→ local audio validation
→ SpeechToTextService.transcribe()
→ transcript + PlannerIntent
→ show visual confirmation UI
```

Privacy-инвариант `no audio before wake word` относится к wake-word mode. В
push-to-talk mode явным разрешением считается нажатие пользователя. Оба режима
используют один recorder, одну local validation и один backend endpoint.

## Audio format

Android пишет короткую команду в формате:

- PCM/LPCM;
- 16 kHz;
- mono;
- 16-bit signed;
- little-endian;
- maxDurationMs: 8000;
- minDurationMs: 500;
- silenceTimeoutMs: 900;
- preRollMs: 200;
- vadEnabled: true.

Backend принимает только PCM 16 kHz mono 16-bit little-endian.

Size limits:

- 8 секунд PCM 16 kHz mono 16-bit: 256 000 bytes;
- backend route hard limit: 400 KB с небольшим запасом на metadata/wrapper.

## Local validation

Перед upload Android обязан проверить:

1. `audioDuration >= 500 ms`.
2. `hasVoiceActivity == true`.
3. Запись не является тишиной.
4. Запись не слишком тихая.
5. `audioDuration <= maxDurationMs`.

Если проверка не прошла, upload не выполняется.

Backend повторяет базовую проверку длительности, размера и формата, потому что
client-side validation не является security boundary.

## Backend endpoint

Endpoint:

```http
POST /api/voice/command
Content-Type: audio/l16
Authorization: Bearer <planner access token>
x-workspace-id: <workspace id>
x-audio-sample-rate: 16000
x-audio-channel-count: 1
x-audio-bits-per-sample: 16
x-audio-byte-order: little_endian
x-audio-encoding: pcm_s16le
x-audio-duration-ms: <duration>
x-stt-source: android_short_clip | android_push_to_talk | web_push_to_talk
```

Development legacy mode without bearer token may use `x-actor-user-id` together
with `x-workspace-id`, following the existing API route context rules.

The endpoint resolves the global `appRole` from the authenticated session and
rejects non-`owner`/non-`test` users with `403 voice_feature_forbidden` before
calling the STT provider.

Response:

```json
{
  "transcript": "добавь задачу позвонить врачу завтра",
  "stt": {
    "transcript": "добавь задачу позвонить врачу завтра",
    "confidence": null,
    "provider": "backend_yandex_speechkit",
    "source": "android_short_clip",
    "durationMs": 1800,
    "billableSecondsEstimated": 2
  },
  "intent": {
    "intent": "create_task",
    "title": "позвонить врачу",
    "datetime": "2026-05-29",
    "rawText": "добавь задачу позвонить врачу завтра",
    "confidence": 0.74,
    "needsConfirmation": true
  }
}
```

Raw audio не сохраняется по умолчанию.

Backend не доверяет полю `source` как security-гарантии. `source` используется
для аналитики и маршрутизации UX. Privacy-инвариант `no audio before wake word`
обеспечивается Android-клиентом и покрывается client-side tests. Backend
дополнительно защищается auth, rate limit, duration/size validation и audit
events.

## Yandex SpeechKit

Backend provider: `YandexSpeechKitProvider` behind `BackendSttProvider`.

Server env/secrets:

- `VOICE_STT_YANDEX_API_KEY` or `YANDEX_API_KEY`;
- `VOICE_STT_YANDEX_IAM_TOKEN` or `YANDEX_IAM_TOKEN`;
- `VOICE_STT_YANDEX_FOLDER_ID` or `YANDEX_FOLDER_ID`;
- `VOICE_STT_YANDEX_ENDPOINT`, default
  `https://stt.api.cloud.yandex.net/speech/v1/stt:recognize`;
- `VOICE_STT_LANGUAGE`, default `ru-RU`;
- `VOICE_STT_TIMEOUT_MS`, default `8000`.

Android не содержит Yandex/OpenAI/Google STT keys и не вызывает STT provider
напрямую.

Yandex SpeechKit synchronous recognition endpoint uses short audio upload with
query params such as `format=lpcm`, `sampleRateHertz=16000`, and `lang=ru-RU`.
Before production release, re-check the current Yandex SpeechKit API and billing
region in official docs:

- https://yandex.cloud/en/docs/speechkit/stt/api/request-api
- https://yandex.cloud/en/docs/speechkit/concepts/auth

## Why not Android SpeechRecognizer

Android `SpeechRecognizer` is not primary provider for v1 because it is
device/Google-services dependent, harder to control consistently, and does not
give the same server-side audit, rate limit, and provider isolation guarantees.
It can be reconsidered later as a local/device fallback if UX and privacy
constraints fit.

## Why not streaming first

Streaming STT is not used first because it can start billable sessions before
useful speech appears. For v1, wake word is local, then Android records and
validates a short clip, then uploads only valid audio.

Streaming STT can be added later only if live transcript is required.

## No TTS in v1

В первой версии cloud TTS, TTS provider и динамические голосовые ответы не
используются.

После wake word и STT приложение показывает визуальное подтверждение:

- overlay `Слушаю` во время записи;
- карточку результата после распознавания;
- кнопки действия.

Для обратной связи разрешены только:

- локальный non-verbal start signal после wake word или Android push-to-talk
  start;
- локальный non-verbal success signal после успешного mutating action;
- вибрация;
- визуальный статус;
- toast/snackbar после выполнения.

Audio signals относятся к Android runtime/action feedback, а не к STT provider.
Они проигрываются из локальных assets, не содержат речи или приватных данных и
не передают текст наружу. Success signal нельзя проигрывать для preview, errors,
`clarify`, `unsupported`, `requiresUnlock`, `get_agenda`, cancel и Undo.

TTS можно рассмотреть позже как отдельную optional-функцию, но он не входит в
пункт 3 и не должен влиять на стоимость первой версии.

Фиксируем:

```text
В первой версии стоимость voice interaction считается только по STT.
Облачный TTS и динамический голосовой ответ не используются.
Визуальное подтверждение является основным способом обратной связи.
```

## Cost model

В документации проекта фиксируется расчет для планирования бюджета. Перед
production нужно перепроверить цену и billing-регион у провайдера.

- 1 команда < 15 sec ≈ 0,1626 ₽ для STT.
- 100 DAU × 5 команд/день × 30 дней ≈ 2 439 ₽/мес.
- 1 000 DAU × 5 команд/день × 30 дней ≈ 24 390 ₽/мес.
- Cloud TTS и динамический голосовой ответ не используются в первой версии.
- Стоимость voice interaction считается только по STT.

## Cost-control rules

1. Не открывать streaming STT до появления реального аудио.
2. Не отправлять аудио, если длительность меньше 500 ms.
3. Не отправлять аудио, если нет voice activity.
4. Не отправлять тишину.
5. Не отправлять слишком тихую запись.
6. Не отправлять запись длиннее `maxDurationMs`.
7. Использовать short-clip upload первым этапом.
8. Streaming STT добавить позже только если нужен live transcript.
9. Не использовать cloud TTS и динамический голосовой ответ в первой версии.
10. Использовать визуальное подтверждение вместо динамического голосового
    ответа.
11. Добавить per-user rate limit.

## Metrics

Android/backend должны логировать только безопасные события без raw audio:

- `stt_recording_started`;
- `stt_recording_stopped`;
- `stt_local_validation_failed`;
- `stt_upload_started`;
- `stt_upload_skipped_no_speech`;
- `stt_upload_skipped_too_short`;
- `stt_upload_skipped_too_quiet`;
- `stt_upload_completed`;
- `stt_error`;
- `stt_low_confidence`;
- `stt_fallback_used`;
- `stt_billable_request_estimated`.

## Error mapping

Ошибки показываются визуально, не голосом:

- `NO_SPEECH`;
- `TOO_SHORT`;
- `TOO_LONG`;
- `TOO_QUIET`;
- `NETWORK_ERROR`;
- `SERVER_STT_UNAVAILABLE`;
- `LOCAL_STT_UNAVAILABLE`;
- `PERMISSION_DENIED`;
- `UNSUPPORTED_AUDIO_FORMAT`;
- `LOW_CONFIDENCE`;
- `RATE_LIMITED`.

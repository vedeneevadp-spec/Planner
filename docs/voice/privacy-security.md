# Voice Privacy & Security

Этот слой защищает уже собранный voice flow:

```text
voice input -> transcript -> PlannerIntent -> confirmation policy -> planner action -> visual result
```

Он не добавляет новые intents и не меняет parser/action logic.

## Инварианты

- В `android_wake_word` mode аудио не уходит в сеть до `WakeWordDetected`.
- В `android_push_to_talk` и `web_push_to_talk` запись/отправка возможны только после явного действия пользователя.
- После wake word или push-to-talk отправляется только короткая команда, прошедшая local validation.
- STT provider вызывается только через backend `/api/voice/command`.
- На клиенте нет STT/LLM provider keys.
- Raw audio не сохраняется на клиенте или backend по умолчанию.
- Transcript, task titles, shopping item names, agenda items и candidate titles не пишутся в metrics/audit без отдельной policy.
- Locked screen не раскрывает transcript, agenda, task titles или candidates.
- Dangerous intent не выполняется без явного confirmation payload.
- Voice feature доступна только `owner` и `test`; `admin`, `user`, `guest` блокируются.

## Client Boundary

Клиентский guard принимает:

```ts
source: 'android_wake_word' | 'android_push_to_talk' | 'web_push_to_talk'
wakeWordDetected?: boolean
explicitUserAction?: boolean
localValidationPassed: boolean
durationMs: number
hasVoiceActivity: boolean
isSilent?: boolean
isTooQuiet?: boolean
```

Правила:

- `android_wake_word` требует `wakeWordDetected=true`.
- `android_push_to_talk` и `web_push_to_talk` требуют `explicitUserAction=true`.
- Все sources требуют local validation, допустимую duration, voice activity, не silent и не too quiet.

Android применяет такой же guard непосредственно перед сетевым STT upload.
В этом документе `android_wake_word` описывает клиентский режим записи. После
локального `WakeWordDetected` Android отправляет на backend уже короткий clip с
`x-stt-source: android_short_clip`; это не разрешает upload до wake word, а
только обозначает тип backend STT-запроса.

## Backend Limits

`/api/voice/command`:

- требует bearer auth;
- пропускает только `owner` и `test`;
- валидирует `x-stt-source` (`android_short_clip`,
  `android_push_to_talk`, `web_push_to_talk`, `local_fallback`, `test_stub`);
- принимает PCM/LPCM 16 kHz mono 16-bit little-endian;
- отклоняет audio короче `500 ms`, длиннее `8000 ms`, тихое или silent audio;
- имеет route body hard limit `400 KB`;
- rate limits by user/device/IP;
- не сохраняет raw audio.

Для PCM 16 kHz mono 16-bit:

```text
1 sec = 32 000 bytes
8 sec = 256 000 bytes
```

`400 KB` оставляет запас на transport overhead и все равно блокирует длинные записи.

## Replay Protection

Каждый request должен иметь:

```text
x-voice-request-id: UUID
x-voice-session-id: non-empty string
x-voice-issued-at: ISO date-time
x-device-id: optional stable device id
```

Backend отклоняет:

- отсутствующие или invalid security headers;
- `issuedAt` старше replay window;
- слишком будущий `issuedAt`;
- повторный `requestId` в пределах `user/device/session`.

Текущая реализация replay cache и rate limiter хранит состояние in-memory внутри
одного API process. Это достаточно для dev, single-process deployment и
ограниченного rollout `owner/test`, но не является production-механизмом для
горизонтального scale. Если API запущен в нескольких replica, replay/rate state
нужно вынести в общий store:

- Redis: `SET NX EX` для одноразовых `requestId`, `INCR/EXPIRE` для rate limit;
- Postgres: таблица с unique key + `expires_at` для replay и счетчики/окна для
  rate limit.

В shared store нельзя писать audio/transcript/task titles. Хранятся только
технические ключи: hash/user id, device id, session id, request id, expiry и
счетчики.

## Audit And Metrics

Разрешенные safe fields:

```ts
eventType
userIdHash
workspaceIdHash
deviceIdHash
ipHash
appRole
source
intentType
previewStatus
resultStatus
errorCode
durationMs
audioBytes
confidenceBucket
createdAt
```

Запрещено по умолчанию:

```text
raw audio
full transcript
task title
shopping item names
agenda item titles
candidate task titles
LLM prompt with user text
STT provider raw response with transcript
```

Audit/metrics redaction должна работать fail-closed:

- не логировать `preview`, `intent`, `task`, `tasks`, `agendaItems`,
  `candidates`, `shoppingItems` целиком;
- рекурсивно удалять nested поля вроде `rawText`, `transcript`, `title`,
  `taskTitle`, `targetQuery`, `shoppingItemName`;
- отбрасывать binary payloads (`Buffer`, `ArrayBuffer`, typed arrays);
- для action events использовать safe payload: `intentType`, `previewStatus`,
  `requiresUnlock`, `canExecute`, `isDangerous`, `reason`, `isOffline`,
  `isStale`.

Safe audit events:

```text
voice_feature_forbidden
voice_permission_revoked
voice_audio_upload_blocked
voice_command_received
voice_command_rejected
voice_action_preview_created
voice_action_execute_requested
voice_action_execute_blocked
voice_action_executed
voice_action_undo_requested
voice_action_undo_failed
dangerous_intent_blocked
locked_screen_access_blocked
replay_rejected
rate_limit_exceeded
```

## Locked Screen

Locked-screen preview is scrubbed:

- no transcript;
- no task titles;
- no shopping item names;
- no agenda items;
- no reschedule candidates;
- only safe `requires_unlock` copy.

Safe copy:

```text
Разблокируй телефон, чтобы продолжить.
```

`get_agenda` and `reschedule_task` always require unlock on locked screen.
Action telemetry/audit must use scrubbed previews or a safe preview telemetry
payload. It must never serialize the original locked-screen `preview`/`intent`
object with `rawText`, agenda items, or candidates.

## Android Permissions

If `RECORD_AUDIO` is revoked:

- wake-word service stops;
- recorder stops;
- pending training audio is cleared;
- background wake word is disabled;
- a visual permission error is stored for the web layer;
- push-to-talk remains disabled until permission is granted again.

If `POST_NOTIFICATIONS` is revoked:

- background wake word is disabled;
- background foreground-service start is blocked;
- foreground/in-app push-to-talk may still work if microphone permission is granted.

Foreground service startup catches Android runtime `SecurityException`/service-start failures and returns a typed visual error instead of crashing.

## Wake-Word Training Opt-In

Wake-word review may keep a short pending fragment in memory. It is written to disk only when the explicit training collection opt-in is enabled. Disabling opt-in clears pending samples.

## Voice Cues

Allowed static cues:

```text
listening
done
```

Rejected:

```text
dynamic spoken text
user data
task titles
agenda content
private lock-screen output
```

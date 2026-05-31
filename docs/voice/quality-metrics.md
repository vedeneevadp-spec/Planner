# Voice Quality Metrics

Пункт 13 делит метрики на два независимых слоя:

1. Offline quality metrics по `voice-command-corpus.v1`.
2. Runtime safe telemetry по реальному voice flow.

Offline report отвечает на вопрос: насколько текущие parser/action/UI policies
проходят общий corpus. Runtime telemetry отвечает на вопрос: как реальные
пользователи проходят voice flow без логирования приватных данных.

## Offline Corpus Report

Команда:

```bash
npm run voice-quality-report
```

Report прогоняет corpus через:

```text
VoiceTestCase
-> PlannerIntentParser
-> PlannerActionExecutor.prepareAction
-> VoiceConfirmationCard status expectation
-> web flow expectation
-> voice cue policy expectation
-> privacy / LLM eligibility expectations
```

Текущий `voice-command-corpus.v1` содержит 195 cases. Report группирует
результаты по `category` и считает:

- `parser_intent_accuracy`
- `required_field_accuracy`
- `parser_clarify_rate`
- `parser_unsupported_rate`
- `dangerous_block_rate`
- `locked_screen_privacy_pass_rate`
- `action_preview_accuracy`
- `confirmation_ui_status_accuracy`
- `web_flow_validation_pass_rate`
- `voice_cue_policy_pass_rate`
- `llm_eligibility_policy_pass_rate`
- `no_private_metrics_policy`

Обычные parser/action accuracy метрики сейчас report-only. Safety метрики
жесткие: report завершится с ошибкой, если любая из них ниже 100%.

Жесткие thresholds:

```text
dangerous_block_rate = 100%
locked_screen_privacy_pass_rate = 100%
voice_cue_policy_pass_rate = 100%
llm_eligibility_policy_pass_rate = 100%
no_private_metrics_policy = 100%
```

## Runtime Safe Telemetry

Shared contract находится в `packages/contracts/src/voice-metrics.ts`.

Runtime metrics принимают только `SafeVoiceMetricEvent`. Payload проходит:

```text
recursive voice metric redaction
-> private-key rejection
-> strict safe schema validation
-> sink transport
```

Запрещено отправлять:

- raw audio, audio blob;
- transcript, rawText;
- title, targetQuery;
- shopping item names;
- agenda item titles;
- candidate task titles;
- full `PlannerIntent`;
- full `VoiceActionPreview`;
- full `VoiceActionResult`;
- LLM prompt;
- STT provider raw response.

Safe fields ограничены event name, source/platform, app role, intent type,
status/error codes, confidence/duration buckets, safe audio size/duration,
provider identifiers, model version and timing metrics.

## Sinks

Contract:

```ts
interface VoiceMetricsSink {
  track(event: SafeVoiceMetricEvent): Promise<void> | void
}
```

Implementations:

- `NoopVoiceMetricsSink`
- `TestVoiceMetricsSink`
- `ConsoleVoiceMetricsSink`
- `BackendVoiceMetricsSink` for web/android client delivery
- `ApiVoiceMetricsSink` for backend-side recording

Client delivery endpoint:

```http
POST /api/voice/metrics
```

The endpoint requires an authenticated owner/test session, rejects role
mismatch, rejects private payloads, and records only the validated safe event.

Endpoint limits:

- max payload size: 16 KB;
- max events per batch: 1 event per request, arrays are rejected;
- rate limit: 120 accepted metric events per 60 seconds per actor/device/IP
  bucket;
- unknown `eventName` values are rejected by the enum schema;
- unknown payload fields are rejected by strict schema validation;
- nested private payloads are rejected before recording;
- full `PlannerIntent`, `VoiceActionPreview`, and `VoiceActionResult` objects
  are rejected.

Runtime metrics are collected to prepare later quality decisions, including
auto-confirm evaluation, but пункт 13 does not enable auto-confirm.
Auto-confirm remains disabled until closed testing and a separate rollout
decision.

## Event Contract

Runtime event names include:

```text
voice_started
wake_detected
push_to_talk_started
command_recording_started
command_recording_cancelled
local_validation_failed
stt_upload_started
stt_upload_completed
stt_error
transcript_received
intent_parsed
action_preview_created
confirmation_shown
confirmation_accepted
confirmation_cancelled
confirmation_edited
clarification_requested
action_executed
action_failed
undo_requested
undo_success
undo_failed
voice_cue_listening_played
voice_cue_done_played
voice_cue_suppressed
web_voice_unsupported
web_voice_permission_denied
web_voice_timeout
```

LLM fallback metric names are present in the contract, but no production LLM
provider is connected in пункт 13:

```text
llm_fallback_requested
llm_fallback_used
llm_fallback_rejected_schema
llm_fallback_rejected_safety
llm_fallback_latency_ms
llm_fallback_provider_error
llm_fallback_cost_estimated
```

## Time To Card

Runtime telemetry supports:

```text
time_to_confirmation_card_ms
wake_detected_to_recorder_start_ms
wake_detected_to_confirmation_card_ms
mic_click_to_confirmation_card_ms
stt_upload_duration_ms
parser_duration_ms
action_preview_duration_ms
```

The web flow records:

```text
mic click -> recording started
recording stopped -> STT upload started
STT upload started -> STT upload completed
STT upload completed -> intent parsed
intent parsed -> action preview created
action preview created -> confirmation shown
```

Android wake-word flow records wake and confirmation-card timings when the
pending native command is consumed. Native cue playback is still controlled by
the Android runtime; telemetry records only safe cue played/suppressed events.

## Retention And Sampling

Current implementation stores client diagnostics only in the in-memory browser
debug ring buffer and forwards safe server-side metric events to the configured
backend sink. It does not add a durable production analytics store.

Policy for the next storage-backed rollout:

- dev/test retention: keep local diagnostic ring buffers for the current
  browser session only; test sinks are cleared by tests;
- production retention: keep safe aggregated voice metrics for no longer than
  90 days unless a shorter incident/debug window is configured;
- sampling: record all safety events and failures; sampling may be applied only
  to high-volume success events after safety counters remain complete;
- access: restrict raw safe metric event access to maintainers who can operate
  voice rollout/debugging; product summaries should use aggregated buckets;
- deletion/cleanup: local diagnostics are cleared by session/browser cleanup;
  production storage must support workspace/user scoped deletion before it is
  enabled.

## Point 14 Preparation

`llmFallbackAllowed` remains a corpus policy flag. Пункт 13 validates that LLM
eligibility is explicit and safe, but does not add a production LLM provider,
does not add auto-confirm, and does not add TTS/cloud TTS.

Point 14 can use the same offline report and runtime contract to compare:

- fallback requested vs used;
- schema rejection rate;
- safety rejection rate;
- fallback latency;
- provider error rate;
- estimated cost.

# Voice test corpus

Статус: `voice-command-corpus.v1` реализован как shared TypeScript fixture в
`packages/contracts/src/voice-test-corpus`.

Цель корпуса - один machine-readable baseline для rule-first parser, action
preview layer, confirmation UI, web push-to-talk, Android runtime expectations,
voice cues, privacy/security checks и будущих metrics/LLM fallback сравнений.

## Source of truth

- Schema: `packages/contracts/src/voice-test-corpus/schema.ts`
- Fixtures: `packages/contracts/src/voice-test-corpus/fixtures.ts`
- Corpus: `packages/contracts/src/voice-test-corpus/corpus.ts`
- Public export: `@planner/contracts`
- Version: `voice-command-corpus.v1`

Формат v1 использует `.ts` fixture вместо JSONL, потому что текущий monorepo уже
раздает shared contracts через TypeScript exports. Каждый case проходит
`voiceTestCaseSchema`, а каждый `expectedIntent` дополнительно проходит
`plannerIntentSchema`. Каждый case также получает явный `llmFallbackAllowed`,
чтобы пункт 14 мог сравнивать rule-only и rule+LLM без включения LLM на опасных
или приватных потоках.

## Maintenance rule

Новый баг голосового ввода сначала фиксируется новым case в
`voice-command-corpus.v1`, и только после этого чинится parser, action layer,
confirmation UI, web flow или Android runtime. Корпус должен расти по failure
buckets закрытого тестирования, а не быть одноразовым списком фраз.

## Parser regression policy

- Любая новая нормализация добавляется через corpus case.
- Ambiguous cases не должны превращаться в auto-execute.
- Dangerous/delete/bulk cases не должны уходить в LLM fallback.
- Shopping normalization не должна ломать границу `shopping` vs dated
  `create_task`.
- Новая dangerous формулировка получает corpus case с `unsupported` или
  blocked preview и no-execute UI expectation.
- Новая STT-ошибка получает corpus case с editable confirmation или clarify
  expectation.
- Locked-screen cases обязаны иметь `mustNotShow` и `mustNotLog` expectations
  для transcript/rawText/title/targetQuery/candidates/agenda/audio, когда эти
  поля применимы.
- LLM-eligible cases явно помечаются `llmFallbackAllowed: true`; все остальные
  остаются `false`.

## LLM fallback eligibility

`llmFallbackAllowed` по умолчанию `false`.

Разрешать `true` можно только для safe low-risk `create_task` и
`add_shopping_item` cases, обычно из STT/noisy buckets, где LLM в будущем может
улучшить разбор текста без чтения приватных данных и без выполнения действия.

Всегда `false`:

- dangerous/delete/bulk;
- locked-screen sensitive flows;
- `reschedule_task`;
- `get_agenda` private read;
- requiresUnlock;
- unsupported dangerous;
- любые cases с `isDangerous = true`.

## Fixed context

Базовый контекст:

- `now = 2026-06-01T09:00:00+05:00`
- `timezone = Asia/Almaty`
- `locale = ru-RU`
- `appRole = owner`
- `isDeviceLocked = false`
- spheres: `home`, `kids`, `garden`, `health`, `finance`, `work`

Есть отдельные fixtures для locked screen и role-gate contexts:
`LOCKED_TEST_CONTEXT`, `TEST_ROLE_CONTEXTS`.

## Coverage matrix

`voice-command-corpus.v1` содержит 195 cases.

| Category         | Count |
| ---------------- | ----: |
| wake_word        |    10 |
| create_task      |    24 |
| reminder_task    |    12 |
| shopping         |    18 |
| agenda           |    12 |
| reschedule       |    19 |
| clarify          |    10 |
| unsupported      |    10 |
| dangerous        |    12 |
| locked_screen    |    12 |
| stt_error        |    12 |
| voice_cue        |    12 |
| web_flow         |    12 |
| android_runtime  |     8 |
| privacy_security |    12 |

Coverage floor is enforced by
`REQUIRED_VOICE_TEST_CORPUS_MINIMUMS` and
`findVoiceCorpusCoverageGaps`.

## Representative cases

| ID               | Phrase                                      | Category      | Expected                     |
| ---------------- | ------------------------------------------- | ------------- | ---------------------------- |
| `task_basic_015` | `завтра в 9 стоматолог`                     | create_task   | task confirmation, date/time |
| `web_flow_011`   | `завтра купить молоко`                      | web_flow      | task, not shopping           |
| `reminder_001`   | `через 10 минут выключить плиту`            | reminder_task | task with `reminderAt`       |
| `shopping_001`   | `добавь молоко и хлеб в покупки`            | shopping      | shopping confirmation        |
| `agenda_001`     | `что у меня сегодня`                        | agenda        | visual agenda, no done cue   |
| `agenda_002`     | `что у меня завтра`                         | agenda        | visual agenda, no done cue   |
| `reschedule_001` | `перенеси помыть окна на субботу`           | reschedule    | dangerous confirmation       |
| `reschedule_017` | `перенеси задачу помыть окна на час раньше` | reschedule    | relative shift confirmation  |
| `dangerous_012`  | `удали задачу`                              | dangerous     | unsupported, no execute      |
| `stt_error_001`  | `палить рассаду вечером`                    | stt_error     | editable confirmation        |
| `wake_word_002`  | `котика`                                    | wake_word     | hard negative, no upload     |

## Test consumers

- Schema/coverage/parser baseline:
  `apps/web/src/features/voice-assistant/model/voice-test-corpus.test.ts`
- Action preview layer:
  `apps/web/src/features/voice-assistant/model/planner-action-executor.test.ts`
- Confirmation UI subset:
  `apps/web/src/features/voice-assistant/ui/VoiceConfirmationCard.test.tsx`
- Web support/audio validation subset:
  `apps/web/src/features/voice-assistant/model/web-voice-input.test.ts`
- Android runtime/cue expectations are encoded in corpus categories
  `android_runtime` and `voice_cue`; native policy tests remain in
  `android/app/src/test/java/ru/chaotika/app`.

## Adding closed-testing failures

1. Add the new phrase to `corpus.ts` with a stable ID before changing behavior.
2. Prefer the existing category; add a category only when it represents a new
   behavior class.
3. Always set fixed `context`; use locked or role fixtures when relevant.
4. Add `expectedIntent` only when the rule parser should own the phrase.
5. Add `expectedPreview`, `expectedUI`, `expectedCue`, `expectedPrivacy`, and
   `expectedMetrics` when the case is meant to protect downstream behavior.
6. Set `llmFallbackAllowed` explicitly; only safe create/shopping ambiguity may
   be `true`.
7. For dangerous or locked-screen cases, set privacy expectations first:
   no transcript, raw text, task titles, shopping items, agenda items,
   candidates, or audio in metrics.
8. Run:

```bash
npm run test:web:run -- voice-test-corpus.test.ts
npm run test:web:run -- planner-action-executor.test.ts
npm run test:web:run -- VoiceConfirmationCard.test.tsx
npm run test:web:run -- web-voice-input.test.ts
```

LLM fallback must use this corpus as the rule-parser baseline and must not be
enabled for dangerous, locked-screen sensitive, delete/bulk, or private-read
flows.

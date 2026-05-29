# PlannerIntentParser v1

`PlannerIntentParser` - общий слой разбора текста для Android wake word,
Android push-to-talk, web push-to-talk и backend text flow.

Parser принимает `transcript + context` и возвращает строго валидный
`PlannerIntent`. Он не выполняет действия, не пишет в базу, не ищет реальные
задачи, не вызывает planner hooks и не создает задачи сам.

## Контракт

Поддерживаемые `intent` v1:

- `create_task`
- `add_shopping_item`
- `reschedule_task`
- `get_agenda`
- `clarify`
- `unsupported`

`create_event`, `create_reminder`, `delete` и старый `reschedule` в v1 не
возвращаются. Напоминание выражается как `create_task` с `reminderAt`. Событие
выражается как `create_task` с `date` и `time`.

Parser context:

```ts
type PlannerIntentParserContext = {
  now?: Date | string
  timezone?: string
  locale?: 'ru-RU'
  source?:
    | 'android_wake_word'
    | 'android_push_to_talk'
    | 'web_push_to_talk'
    | 'backend_text'
  isDeviceLocked?: boolean
  spheres?: Array<{ id: string; name: string; keywords?: string[] }>
  appRole?: 'owner' | 'test' | 'admin' | 'user' | 'guest'
}
```

## Pipeline

```text
transcript
→ normalize text
→ rule parser
→ slot extraction
→ confidence scoring
→ safety flags
→ schema validation
→ optional backend LLM fallback
→ final PlannerIntent
```

Rules run first. Backend LLM fallback is optional and only receives text
`transcript + context`, never audio. Client code must not store LLM keys and must
not call an LLM directly.

Every parser result is validated by `plannerIntentSchema`. Invalid backend LLM
output is ignored and the rule-parser result is returned.

`BackendPlannerIntentFallback` currently exists as an interface hook. A
production LLM provider for `PlannerIntentParser` is not connected yet.

Alice parser and Voice `PlannerIntentParser` are separate flows. The `ALICE_LLM_*`
configuration described in the README belongs to Yandex Dialogs/Alice command
parsing and is not the production LLM fallback for voice/web `PlannerIntent`.

## Examples

| Transcript                        | Intent result                                            |
| --------------------------------- | -------------------------------------------------------- |
| `завтра в 9 стоматолог`           | `create_task`, `date`, `time`, `needsConfirmation: true` |
| `завтра купить молоко`            | `create_task`, `datePrecision: date_only`                |
| `через 10 минут выключить плиту`  | `create_task`, `reminderAt`, `needsConfirmation: false`  |
| `добавь молоко и хлеб в покупки`  | `add_shopping_item`, two `items`                         |
| `купи хлеб яйца и яблоки`         | `add_shopping_item`, three `items`                       |
| `что у меня сегодня`              | `get_agenda`, today date                                 |
| `что у меня завтра`               | `get_agenda`, tomorrow date                              |
| `перенеси помыть окна на субботу` | `reschedule_task`, `targetQuery`, date, dangerous        |
| `удали задачу`                    | `unsupported`, dangerous                                 |

## Safety Flags

- `add_shopping_item`: safe when confidence is high and items are clear.
- `create_task` with exact relative `reminderAt`: safe parser result, but runtime
  still waits for confirmation until Undo exists.
- `create_task` with `date/time`: `needsConfirmation: true`.
- `reschedule_task`: `needsConfirmation: true`, `isDangerous: true`.
- `get_agenda`: `requiresUnlock: true` when `isDeviceLocked` is true.

## Known Limitations

- Parser extracts `targetQuery` for reschedule but does not search tasks.
- Sphere resolution is soft and only uses the spheres passed in context.
- Approximate times such as `утром` and ambiguous times such as `в 8` require
  confirmation.
- Recurrence support is intentionally limited to basic parser signals. Full
  recurring-action semantics belong to the action/model layer.
- Backend fallback is an interface hook; provider configuration stays in backend
  infrastructure, outside client bundles.

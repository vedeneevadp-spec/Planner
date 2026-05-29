# Voice Action Layer v1

Статус: реализован v1 web/client action layer. Это не полный production
backend/action infrastructure.

## Responsibility

`PlannerActionExecutor` принимает уже готовый `PlannerIntent` и превращает его в
безопасное действие приложения. Он не распознает аудио, не вызывает STT, не
парсит transcript заново и не вызывает LLM.

Путь выполнения:

```text
PlannerIntent
→ prepareAction
→ preview / blocked status
→ user confirmation when needed
→ executeAction
→ existing planner/shopping mechanisms
→ visual result
```

Action layer не проигрывает аудио. Он возвращает `VoiceActionResult` с
`visualStatus`; Android runtime может использовать успешный результат
изменяющего действия как сигнал для локального static cue `Готово`.

## Supported Intents

v1 поддерживает:

- `create_task`
- `add_shopping_item`
- `reschedule_task`
- `get_agenda`
- `clarify`
- `unsupported`

Отдельные модели `Event` и `Reminder` не создаются. Событие остается задачей с
`plannedDate` и `plannedStartTime`. Напоминание остается задачей, построенной из
`PlannerIntent.reminderAt`, через существующие поля расписания и reminder
offsets.

## prepareAction vs executeAction

`prepareAction(intent, context)`:

- валидирует intent;
- проверяет `appRole`;
- применяет lock-screen policy;
- ищет candidates для `reschedule_task`;
- читает agenda для `get_agenda`;
- строит `VoiceActionPreview`;
- не пишет данные.

`executeAction(previewId, confirmedPayload)`:

- повторно проверяет роль и unlock policy;
- выполняется только после confirmation;
- для переноса проверяет `version`;
- вызывает существующие planner/shopping механизмы;
- возвращает только visual status.

Пока Undo для голосовых действий не реализован, auto-confirm отключен.

## Implemented v1 Scope

Реализовано:

- `create_task` через существующий planner create flow;
- `add_shopping_item` через существующий shopping list flow, включая несколько
  items;
- `get_agenda` как visual preview, с locked-screen policy и offline cache;
- `reschedule_task` через candidate search, `0 / 1 / 2+` states, confirmation и
  `version` check;
- `clarify` и `unsupported` как безопасные preview states;
- role gate: `owner` и `test` доступны, `admin`/`user`/`guest` заблокированы;
- `test` не получает admin-права и проходит обычные workspace checks.

Вне пункта 5:

- backend `/voice/action/prepare` и `/voice/action/execute`;
- persistent preview storage;
- production telemetry sink;
- Undo;
- auto-confirm;
- full clarification loop;
- production LLM fallback provider;
- Android end-to-end проверка action execution на реальном устройстве.

Куда переходят deferred items:

- full clarification loop - confirmation UI roadmap;
- Undo - confirmation UI roadmap, до включения auto-confirm;
- auto-confirm - после Undo и метрик качества;
- production telemetry sink - voice quality metrics stage;
- production LLM fallback provider - отдельный backend-only LLM fallback stage;
- Android end-to-end action execution - closed testing и release gate;
- backend `/voice/action/prepare` и `/voice/action/execute` + persistent preview
  storage - optional server-side action orchestration. Делать только если
  closed testing покажет, что client-side preview/execute недостаточен для
  Android, multi-device, long-running или server-audited flows.

## create_task

Маппинг идет в существующий planner create flow:

- `title` → `task.title`;
- `date` / `time` → `plannedDate` / `plannedStartTime`;
- `reminderAt` → задача с расписанием и reminder offsets;
- `priority` → urgency/importance/resource;
- `sphereId` → `sphereId`;
- поддерживаемая recurrence → task recurrence.

`create_task` всегда проходит через preview и confirmation.

## add_shopping_item

Executor создает один или несколько shopping items через существующий shopping
list flow. Каждый item получает `text` из `PlannerIntent.items`; source остается
обычным путем shopping list, чтобы offline queue и sync не расходились.

## get_agenda

На locked screen agenda не раскрывается:

```text
isDeviceLocked = true → requires_unlock
```

На unlocked device executor читает задачи на дату из intent и возвращает
визуальный список. Если API недоступен, но есть локальный cache, возвращается
stale preview с пометкой `Может быть неактуально`. Если cache нет, действие
блокируется с offline message.

## reschedule_task

`reschedule_task` считается dangerous и всегда требует подтверждения.

Prepare:

- locked screen → `requires_unlock`;
- offline без надежной версии → `blocked`;
- 0 candidates → `not_found`;
- 1 candidate → `ready_for_confirmation`;
- 2+ candidates → `multiple_candidates`.

Execute:

- требует выбранный `taskId` и `version`;
- перед update повторно читает текущую задачу;
- если `version` изменилась → `requires_refresh`;
- вызывает existing task schedule API с `expectedVersion`;
- recurring series массово не меняет, переносит только выбранную задачу.

## Permissions

Voice actions доступны только глобальным `owner` и `test`.

`test` означает обычные workspace permissions плюс feature access. Он не
получает admin-права. Все записи проходят через текущие planner/shopping
механизмы, поэтому обычные workspace checks продолжают действовать.

`admin`, `user` и `guest` получают `blocked` / `voice_feature_forbidden`.

## Locked-Screen Policy

| Intent              | Locked screen                          |
| ------------------- | -------------------------------------- |
| `create_task`       | можно подготовить без приватных данных |
| `add_shopping_item` | можно подготовить                      |
| `get_agenda`        | запрещено, нужен unlock                |
| `reschedule_task`   | запрещено, нужен unlock                |
| `clarify`           | можно показать безопасный вопрос       |
| `unsupported`       | можно показать безопасный текст        |

## Offline Behavior

- `create_task`: использует существующий planner offline queue, если он
  доступен.
- `add_shopping_item`: использует существующий shopping offline queue, если он
  доступен.
- `get_agenda`: читает cache с stale пометкой или возвращает offline error.
- `reschedule_task`: не выполняется offline в v1 без надежной `version`.

## Version Rules

Candidates для `reschedule_task` содержат:

- `taskId`;
- `version`;
- `updatedAt`;
- текущие schedule fields.

Confirmation payload возвращает выбранный `taskId` и `version`. `executeAction`
сравнивает их с текущей задачей и отправляет `expectedVersion` в update.

## Metrics

Action layer должен логировать только безопасные технические события:

- action type;
- preview status;
- result status;
- error code;
- source;
- workspace/user identifiers по существующей policy.

Transcript и приватные task titles не должны попадать в metrics без отдельной
privacy policy.

## Voice Cues

Локальные voice cues относятся к Android runtime, а не к executor.

`Готово` можно проигрывать только если `VoiceActionResult.status === 'success'`
и действие изменило данные:

- `create_task`;
- `add_shopping_item`;
- `reschedule_task`.

`Готово` нельзя проигрывать для:

- preview без execute;
- `get_agenda`;
- `clarify`;
- `unsupported`;
- `requires_unlock`;
- `not_found`;
- `multiple_candidates`;
- failed/cancelled/requires_refresh results.

Executor не должен возвращать приватный spoken text. Все пользовательские детали
остаются в visual UI.

## Tests

Покрытие v1:

- mapping `create_task` date/time/reminderAt;
- отсутствие отдельных Event/Reminder путей;
- multiple shopping items;
- agenda locked/unlocked/offline cache;
- reschedule 0/1/2+ candidates;
- stale version rejection;
- role gate for `admin`/`user`/`guest`;
- `test` role without elevated workspace permissions;
- auto-confirm disabled until Undo exists.

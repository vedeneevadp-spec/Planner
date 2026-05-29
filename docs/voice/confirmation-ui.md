# Voice Confirmation UI

Статус: v1 smart confirmation UI для web/client voice flow.

## Responsibility

`VoiceConfirmationCard` находится между `PlannerActionExecutor.prepareAction()`
и `PlannerActionExecutor.executeAction()`.

Компонент:

- принимает `VoiceActionPreview` и `VoiceActionResult`;
- показывает понятное визуальное резюме действия;
- объясняет риск и причину подтверждения;
- дает пользователю выбор: подтвердить, изменить, повторить, отменить,
  уточнить или выполнить `Undo`;
- не парсит transcript заново;
- не вызывает STT, LLM, TTS или cloud TTS;
- не выполняет planner/shopping операции напрямую.

Выполнение mutating actions идет только через
`PlannerActionExecutor.executeAction()`. Отмена идет через
`PlannerActionExecutor.undoAction()`, который использует существующие
planner/shopping механизмы.

## Statuses

Preview statuses:

- `ready_for_confirmation` - действие готово к подтверждению;
- `requires_unlock` - приватные данные не раскрываются, нужно разблокировать;
- `requires_clarification` - нужен уточняющий ответ;
- `not_found` - задача не найдена;
- `multiple_candidates` - найдено несколько задач, нужен выбор;
- `unsupported` - команда не поддерживается;
- `blocked` - действие сейчас недоступно.

UI-level statuses:

- `success` - successful `VoiceActionResult`;
- `error` - failed/cancelled/requires_refresh result или state error.

## Card Layouts

`create_task` показывает:

- название;
- дату;
- время;
- `reminderAt`, если есть;
- сферу;
- приоритет;
- confidence;
- причину подтверждения.

`add_shopping_item` показывает список товаров и destination `покупки`.

`reschedule_task` показывает выбранную задачу, старую дату/время, новую
дату/время и warning: действие меняет существующую задачу.

`get_agenda` показывает только visual summary и список задач. Оно не требует
кнопки выполнения и не должно приводить к cue `Готово`.

`requires_unlock` не показывает transcript, agenda items или task titles.

`multiple_candidates` требует выбрать radio-кандидата до выполнения.

`not_found` предлагает изменить запрос или перейти к отдельному `create_task`
preview. Новая задача не создается молча.

`unsupported` не показывает кнопку выполнения для dangerous actions, включая
delete/bulk.

## Dangerous Confirmation

В v1:

- `create_task` - normal;
- `add_shopping_item` - normal;
- `reschedule_task` - dangerous;
- delete/bulk - `unsupported` + dangerous, без execute button.

Для `reschedule_task` кнопка подтверждения звучит явно: `Да, перенести`.

## Clarify Loop

Clarification loop ограничен:

```text
MAX_CLARIFICATION_ATTEMPTS = 2
```

UI показывает вопрос, быстрые варианты, ручное редактирование и повтор
микрофона. После лимита можно сохранить transcript во входящие как обычную
задачу только если preview не dangerous.

## Undo

`VoiceActionResult.undo` появляется только для successful reversible mutating
actions.

Поддержано:

- `create_task` - удалить созданную задачу через существующий planner remove
  flow;
- `add_shopping_item` - удалить созданные shopping items через существующий
  shopping remove flow;
- `reschedule_task` - восстановить previous schedule через `taskClient` с
  `expectedVersion` обновленной задачи.

Если `undo` payload отсутствует, UI не показывает кнопку `Отменить`.

## Auto-Confirm Policy

Auto-confirm остается выключенным. Runtime остается confirmation-first, пока
Undo и tests не будут признаны достаточными для allowlist.

Будущий allowlist может включать только:

- `add_shopping_item`;
- `create_task` с точным относительным `reminderAt`.

Условия будущего включения:

- `confidence >= 0.85`;
- нет ambiguity;
- intent не dangerous;
- action обратим;
- `Undo` доступен;
- соответствующие tests проходят.

## Tests

Покрытие v1:

- `create_task` confirmation;
- shopping confirmation;
- dangerous reschedule confirmation;
- `multiple_candidates`;
- `not_found`;
- `requires_unlock`;
- clarify loop;
- unsupported dangerous delete;
- cancel/edit do not execute;
- Undo for `create_task`;
- Undo for `add_shopping_item`;
- Undo for `reschedule_task`;
- no auto-confirm before Undo policy changes;
- `get_agenda` remains visual-only.

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
микрофона.

После лимита:

- если intent не dangerous и есть безопасный transcript/title, UI предлагает
  `Сохранить во входящие`;
- fallback тоже идет через отдельный `create_task` preview и не создает задачу
  молча;
- если intent dangerous, locked или sensitive, UI не сохраняет fallback и
  предлагает ввести команду вручную.

Edit flow открывает редактируемый transcript/preview. Изменение текста или
полей не вызывает `executeAction()` автоматически: после edit пользователь
снова видит preview и подтверждает действие отдельно.

## Multiple Candidates

`multiple_candidates` требует выбрать radio-кандидата до выполнения. Confirm
payload передает выбранные:

```text
candidateTaskId
expectedVersion
```

При смене выбранного кандидата summary в `reschedule_task` обновляет старую
дату/время для выбранной задачи. `executeAction()` повторно читает текущую
задачу и сверяет `expectedVersion` перед update.

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

Undo failure behavior:

- успешный Undo показывает visual status `Отменено` / `... отменено`;
- неуспешный Undo показывает `Не удалось отменить. Обнови экран.`;
- Undo не проигрывает cue `Готово`;
- Undo payload используется один раз: после успешного или failed Undo кнопка
  `Отменить` скрывается;
- после успешного Undo persistent undo history не создается.

TTL:

- Undo - ephemeral UI action;
- Undo доступен только в текущей карточке и только 30 секунд;
- persistent undo history не входит в v1.

Offline behavior:

- `create_task` Undo использует существующий planner remove/offline flow, если
  он доступен;
- `add_shopping_item` Undo использует существующий shopping remove/offline
  flow, если он доступен;
- `reschedule_task` Undo offline не выполняется без свежей версии задачи и
  показывает `Нужно подключение, чтобы отменить перенос.`.

## Auto-Confirm Policy

Auto-confirm остается выключенным. Runtime остается confirmation-first, пока
метрики качества и closed testing не подтвердят allowlist.

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

Обычному пользователю нельзя давать toggle auto-confirm до отдельного rollout.

## Android Parity

`VoiceConfirmationCard` реализован в web/client UI. Android runtime использует
тот же UI через Capacitor WebView: native layer отвечает за wake word, запись,
STT bridge и local static cues, но не имеет отдельного native confirmation
overlay и не выполняет planner/shopping actions напрямую.

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
- Undo failure/TTL;
- no `Готово` cue after Undo;
- no auto-confirm before Undo policy changes;
- `get_agenda` remains visual-only.

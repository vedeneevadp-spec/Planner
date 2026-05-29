# Голосовой помощник

Документ фиксирует целевое поведение первой версии голосового помощника
Chaotika Planner. Это source-of-truth для Android, web, parser, confirmation UI
и правил безопасности.

Главный принцип одинаковый для всех платформ:

```text
voice input
→ transcript
→ PlannerIntent
→ confirmation policy
→ planner action
→ visual result
```

Все голосовые команды должны проходить через общий `PlannerIntentParser` или
backend parser и приводиться к единому формату `PlannerIntent`.

Голосовой ответ v1 ограничен локальными статическими audio cues. В первой
версии не используется TTS, cloud TTS и динамически сгенерированные голосовые
ответы. Разрешены только короткие локальные реплики:

- `Слушаю`;
- `Готово`.

Первый production rollout закрыт feature-gate по глобальной роли приложения:

- `appRole = owner` - голосовой ввод доступен;
- `appRole = test` - голосовой ввод доступен с правами обычного пользователя;
- `appRole = admin`, `user`, `guest` - голосовой ввод скрыт в UI и запрещен на
  backend.

Роль `test` не дает admin-права и не меняет права workspace. Это `user` +
доступ к тестируемым функциям, сейчас к голосовому вводу.

## Целевое поведение v1

### Общая концепция

Android - основной сценарий голосового помощника:

- запуск по wake-фразе `Хаотика`
- ручной push-to-talk через кнопку микрофона внутри приложения
- работа wake-фразы при открытом приложении
- работа wake-фразы в фоне с постоянным notification
- работа wake-фразы на заблокированном экране
- после активации пользователь произносит короткую команду
- команда преобразуется в `PlannerIntent`
- результат показывается в confirmation UI
- простые покупки и простые напоминания могут выполняться после подтверждения
  или по отдельной auto-confirm policy
- опасные действия всегда требуют подтверждения

Web - упрощенный сценарий:

- wake word не реализуется
- пользователь нажимает кнопку микрофона
- произносит команду
- команда преобразуется в тот же `PlannerIntent`
- используется тот же confirmation UI, что и на Android

Целевой Android wake-word provider первой версии - внутренний
`CustomWakeWordEngine` на TensorFlow Lite. Wake-фраза одна и фиксированная:
`Хаотика`. Runtime использует локальную модель `wakewords/haotika.tflite`, а
`MockWakeWordEngine` остается только для tests/dev. `WakeWordService` должен
зависеть только от интерфейса `WakeWordEngine` и не должен импортировать классы
TensorFlow Lite напрямую.

### Android-сценарий

На Android есть два способа запуска записи команды:

1. Wake word `Хаотика`.
   В этом режиме аудио нельзя отправлять на backend до `WakeWordDetected`.
2. Кнопка микрофона внутри приложения.
   В этом режиме пользователь явно нажал кнопку, поэтому запись команды может
   стартовать сразу после нажатия. Source: `android_push_to_talk`. Аудио
   проходит ту же local validation и отправляется только на backend
   `/api/voice/command`.

Единственная wake-фраза:

```text
Хаотика
```

Пользователь не может выбирать wake-фразу из списка или задавать собственную
фразу. В настройках можно включать/выключать wake word и управлять разрешениями,
но сама фраза активации остается фиксированной: `Хаотика`.

В коде не нужно закладывать пользовательскую настройку wake-фразы.
Производственная реализация подключается через `WakeWordEngine` как
`CustomTfliteWakeWordEngine`, чтобы `WakeWordService` не зависел напрямую от
TensorFlow Lite runtime.

Фиксированный model config:

```json
{
  "phraseId": "haotika",
  "displayPhrase": "Хаотика",
  "language": "ru-RU",
  "modelVersion": "pending-trained-model",
  "modelPath": "wakewords/haotika.tflite",
  "threshold": 0.65,
  "sampleRate": 16000,
  "vadEnabled": true
}
```

Если модели нет в assets, `CustomTfliteWakeWordEngine` должен вернуть
`MissingModel` error, а не падать.

После распознавания wake-фразы приложение должно идти по обычному production
flow:

1. Приостановить wake-word listening.
2. Проиграть локальный audio cue `Слушаю`.
3. Дать вибрацию.
4. Показать маленький overlay `Слушаю`.
5. Начать записывать короткую голосовую команду после cue или с безопасным
   pre-roll, чтобы не записать сам cue в STT и не обрезать начало команды.
6. Проверить аудио локально.
7. Отправить валидный short clip только на backend STT endpoint.
8. Показать визуальное подтверждение результата.

Для закрытого тестирования в админских настройках workspace есть режим
дообучения wake word. Если он включен, между wake word и записью команды
добавляется отдельный временный шаг оценки:

1. Открыть отдельное окно оценки срабатывания wake word.
2. Показать варианты `Верно`, `Ложно`, `Пропустить`, `Записать` и чекбокс
   разрешения на сохранение короткого аудио-примера wake-фразы.
3. Сохранять фрагмент для обучения только после явного разрешения и выбранной
   оценки; без разрешения фрагмент можно держать только в памяти и затем
   удалить.
4. После оценки дать выбор: `Продолжить` или `Отмена`.
5. Если пользователь нажал `Отмена`, прервать текущий voice-flow и вернуться к
   ожиданию wake word.
6. Если пользователь нажал `Продолжить`, перейти к обычному production flow
   записи команды.

Если режим дообучения выключен, окна оценки и записи примера нет: весь флоу
голосового ввода идет по обычному production flow. Окно оценки можно убрать
позже без изменения основного STT/parser/confirmation flow.

При запуске с кнопки микрофона шаги записи, local validation, backend STT и
confirmation UI такие же, но без ожидания wake word.

Пример:

```text
Пользователь: “Хаотика”
Приложение: локальный cue “Слушаю” + вибрация + overlay “Слушаю”
Пользователь: “Завтра позвонить врачу”
Приложение: распознает команду → показывает карточку действия
```

Формат ответа на Android:

- визуальный overlay во время записи
- визуальная карточка результата
- кнопки подтверждения, редактирования и отмены
- без TTS и без динамического голосового ответа

В первой версии не использовать TTS. Помощник не озвучивает результат и не
произносит приватные данные. Результат отображается визуально. Допускаются
только локальные статические audio cues `Слушаю` и `Готово`.

### Локальные voice cues

Voice cues - это Android-only v1 и не являются TTS. Они проигрываются из
локальных assets, не содержат приватных данных и не требуют сетевого запроса.

Разрешенные cues:

```text
Слушаю
Готово
```

Рекомендуемые assets:

```text
android/app/src/main/res/raw/voice_cue_listening_ru.*
android/app/src/main/res/raw/voice_cue_done_ru.*
```

Формат файлов: 0.4-1.0 сек, mono, 16-24 kHz, wav/ogg, без фоновой музыки.

`Слушаю` играть:

- после `WakeWordDetected`;
- после явного Android push-to-talk start;
- вместе с visual overlay `Слушаю`;
- до записи команды или с pre-roll logic, чтобы cue не попадал в STT.

`Готово` играть только после успешного `executeAction`, когда действие реально
изменило данные:

- `create_task` success;
- `add_shopping_item` success;
- `reschedule_task` success.

`Готово` не играть:

- если показана только preview card;
- если требуется confirmation;
- если действие заблокировано;
- если `requiresUnlock`;
- если `clarify` или `unsupported`;
- если STT/parser/action вернул ошибку;
- если пользователь отменил действие;
- если `get_agenda` только показал список.

Web v1 остается без voice cues и использует только визуальные статусы.

Примеры визуального подтверждения:

```text
Новая задача

Название: Позвонить врачу
Дата: завтра
Время: не указано
Сфера: здоровье
Напоминание: нет

[Сохранить] [Изменить] [Отмена]

Добавить в покупки

Молоко
Хлеб
Яблоки

[Добавить] [Изменить] [Отмена]

Я не уверена, что правильно поняла

Распознано:
“завтра позвонить врачу”

[Сохранить] [Изменить] [Повторить] [Отмена]
```

### Заблокированный экран

На заблокированном экране разрешены только безопасные действия.

Разрешено:

- создать новую задачу
- добавить покупку

Запрещено без разблокировки:

- просматривать расписание
- озвучивать личное расписание
- удалять задачи
- переносить задачи
- изменять повторяющиеся задачи
- выполнять массовые изменения
- читать приватные данные вслух

Пример разрешенного сценария:

```text
Пользователь: “Хаотика, добавь молоко в покупки”
Визуальный статус на экране/notification: “Добавлено в покупки.”
```

Пример запрещенного сценария:

```text
Пользователь: “Хаотика, что у меня завтра?”
Визуальный статус: “Разблокируй телефон, чтобы я показала расписание.”
```

На заблокированном экране auto-confirm разрешен только для:

- `add_shopping_item`;
- `create_task` с `reminderAt` без просмотра существующих приватных
  данных.

На lock screen нельзя показывать содержимое расписания, список задач, найденные
совпадения и приватные детали. Если действие требует чтения существующих
данных, нужен unlock. `reschedule_task` на заблокированном экране запрещен, потому
что перенос требует поиска существующей задачи.

### Язык и offline-режим

На первом этапе поддерживается только русский язык:

```text
language: ru-RU
```

Offline-режим:

- wake word всегда должен обрабатываться локально
- до wake-фразы аудио не отправляется на сервер
- распознавание основной команды после wake-фразы может быть online
- полный offline STT не является обязательным требованием первой версии

При отсутствии интернета после wake-фразы:

- не выполнять действие молча
- показать overlay с ошибкой
- предложить повторить позже или ввести команду вручную

Пример визуального сообщения:

```text
Сейчас нет интернета. Введи задачу вручную или попробуй позже.
```

Privacy-правило:

```text
До wake-фразы никакое аудио не отправляется на сервер.
После wake-фразы можно отправлять только короткую команду пользователя для STT/parser, если голосовой режим включен пользователем.
После явного нажатия кнопки микрофона можно записывать короткую команду без wake word, но с теми же local validation и backend-only STT правилами.
Стоимость voice interaction в первой версии считается только по STT. Облачный
TTS не используется. Локальные статические audio cues не отправляют текст или
аудио наружу.
```

### Web-сценарий

В web-версии wake word не реализуется.

Сценарий:

1. Пользователь нажимает кнопку микрофона.
2. Произносит команду.
3. Система получает transcript.
4. Transcript отправляется в общий `PlannerIntentParser`.
5. Пользователь видит тот же confirmation UI, что и на Android.
6. После подтверждения действие выполняется.

Пример:

```text
Пользователь нажимает 🎙
Говорит: “В субботу помыть окна”
Система показывает карточку:

Новая задача
Название: Помыть окна
Дата: суббота
Время: не указано

[Сохранить] [Изменить] [Отмена]
```

### Поддерживаемые команды первой версии

В первой версии поддерживается минимальный набор команд:

1. Создать задачу.
2. Добавить покупку.
3. Перенести задачу.
4. Спросить `что у меня сегодня?`.
5. Спросить `что у меня завтра?`.

На первом этапе не создавать отдельную модель событий. Событие в классическом
календарном смысле считается обычной задачей с датой и временем.

### Модели: задача, покупка, напоминание

#### Задача

Задача - это действие, которое пользователь хочет выполнить.

Примеры:

```text
позвонить врачу
записать Кирилла на английский
проверить оплату
помыть окна
в субботу убрать дом
завтра купить грунт
```

У задачи могут быть:

- название
- срок
- точное время
- приоритет
- сфера/категория
- `reminderAt`
- повторение

Если задача имеет точное время, она все равно остается задачей, а не отдельным
событием.

Пример:

```text
“завтра в 9 стоматолог”
→ задача с dueDate и dueTime
```

#### Покупка

Покупка - отдельный тип действия, который добавляет один или несколько товаров в
список покупок.

Примеры:

```text
добавь молоко в покупки
купи хлеб, яйца и яблоки
добавь в список покупок корм для кота
```

Ожидаемое поведение:

```text
“добавь молоко в покупки”
→ добавить item “молоко” в покупки
→ показать visual status “Добавлено в покупки.”
```

Для нескольких товаров:

```text
“добавь хлеб, молоко и яблоки в покупки”
→ создать 3 shopping items
```

#### Напоминание

Отдельную модель `Reminder` не создавать. Напоминание хранить как задачу с
заполненным `reminderAt`.

Примеры:

```text
через 20 минут выключить духовку
напомни вечером полить рассаду
через час проверить суп
```

Ожидаемое поведение:

```text
“через 20 минут выключить духовку”
→ создать задачу:
   title: “выключить духовку”
   reminderAt: now + 20 minutes
```

Такие задачи можно помечать внутренним флагом, например:

```ts
const voiceTaskMetadata = {
  source: 'voice',
  kind: 'reminder_like',
} as const
```

Но отдельную таблицу/модель напоминаний не создавать.

### Даты и время

Если пользователь указал дату без точного времени, создавать задачу без времени.

Примеры:

```text
“завтра купить молоко”
→ задача с dueDate = завтра, dueTime = null

“в субботу убрать дом”
→ задача с dueDate = ближайшая суббота, dueTime = null

“на следующей неделе записаться к врачу”
→ задача без точного времени, с периодом/текстовым указанием “следующая неделя”
```

Если пользователь указал точное время, сохранять его в задаче.

Пример:

```text
“завтра в 9 стоматолог”
→ задача:
   title: “стоматолог”
   dueDate: завтра
   dueTime: 09:00
```

Если пользователь указал относительное время для напоминания:

```text
“через 10 минут выключить плиту”
→ задача:
   title: “выключить плиту”
   reminderAt: now + 10 minutes
```

Если время распознано неуверенно, не выполнять действие молча.

Пример:

```text
Я не уверена во времени. Поставить на завтра утром?
```

### Категории и сферы

Категории брать из существующего списка сфер пользователя. Parser должен
пытаться определить сферу автоматически по тексту.

Примеры:

```text
“помыть окна”
→ сфера: дом

“записать Кирилла на английский”
→ сфера: дети

“купить грунт для рассады”
→ сфера: сад

“проверить оплату”
→ сфера: финансы или работа, в зависимости от контекста
```

Если сфера не определяется уверенно:

- не задавать лишний вопрос
- создать задачу без сферы или в дефолтной сфере
- показать сферу в карточке как редактируемое поле

### Опасные действия

Опасные действия никогда не выполняются автоматически.

К опасным действиям относятся:

- удалить задачу
- перенести задачу
- изменить повторяющуюся задачу
- массовое изменение
- массовое удаление
- прочитать личное расписание вслух
- показать расписание на заблокированном экране
- отправить приватные данные пользователя на сервер вне сценария STT/parser
- выполнить действие, когда найдено несколько похожих задач
- выполнить действие при низкой уверенности распознавания

Для опасных действий нужно:

1. Показать, что именно будет изменено.
2. Запросить явное подтверждение.
3. При необходимости потребовать разблокировку телефона.

Пример:

```text
Пользователь: “Перенеси помыть окна на субботу”

Если найдена одна задача:
“Перенести задачу ‘Помыть окна’ на субботу?”

[Перенести] [Отмена]
```

Если найдено несколько задач:

```text
Нашла две похожие задачи. Какую перенести?
```

Если телефон заблокирован:

```text
Разблокируй телефон, чтобы перенести задачу.
```

### Автоподтверждение

Автоматически можно выполнять только простые безопасные действия при высокой
уверенности распознавания.

Auto-confirm разрешен только если:

- intent не dangerous;
- confidence >= 0.85;
- STT не low confidence;
- нет ambiguity;
- действие относится к allowlist:
  - `add_shopping_item`;
  - `create_task` с `reminderAt` и точным относительным
    временем.

Auto-confirmed action не показывает confirmation card перед выполнением, но
после выполнения обязательно показывает visual result с `Undo`, если действие
обратимое. Пока `Undo` для голосовых действий не реализован, runtime остается в
режиме confirmation-first и не выполняет auto-confirm.

Примеры:

```text
“через 10 минут выключить плиту”
→ сразу создать задачу с reminderAt
→ показать snackbar/card update: “Напоминание сохранено.” + Undo

“добавь молоко в покупки”
→ сразу добавить покупку
→ показать snackbar/card update: “Добавлено в покупки.” + Undo

“добавь хлеб, яйца и яблоки в покупки”
→ сразу добавить 3 покупки
→ показать snackbar/card update: “Добавлено в покупки.” + Undo
```

Не автоподтверждать:

- перенос задачи
- удаление задачи
- изменение повторяющейся задачи
- массовые действия
- задачи с неуверенной датой
- задачи с точным временем, которые похожи на календарное событие
- команды `что у меня сегодня/завтра` на заблокированном экране

Пример задачи, которую лучше подтвердить:

```text
“завтра в 9 стоматолог”

Показать карточку:
Задача: Стоматолог
Когда: завтра, 09:00

[Сохранить] [Изменить] [Отмена]
```

### Неуверенное распознавание

При неуверенном распознавании не выполнять действие молча.

Система должна:

- показать варианты
- задать уточняющий вопрос
- предложить ручное редактирование
- не сохранять действие без подтверждения

Рекомендуемые пороги:

```text
confidence >= 0.85
→ можно предлагать действие;
→ для покупок и простых напоминаний можно автоподтверждать.

confidence >= 0.60 and < 0.85
→ показать карточку с предупреждением;
→ попросить подтверждение.

confidence < 0.60
→ задать уточняющий вопрос;
→ не создавать задачу автоматически.
```

Примеры визуальных сообщений:

```text
Я не уверена во времени. Поставить на завтра утром?
Я не уверена, что правильно поняла. Ты сказала: “помыть окна в субботу”?
Нашла два похожих варианта. Какой выбрать?
```

### Команда “что у меня сегодня/завтра”

Команды просмотра плана поддержать в первой версии.

Примеры:

```text
что у меня сегодня?
что у меня завтра?
какие задачи на сегодня?
что запланировано на завтра?
```

Поведение:

- если телефон разблокирован: показать список задач в карточке
- показать короткий visual summary в карточке
- не читать весь список вслух автоматически
- если телефон заблокирован: потребовать разблокировку

Пример визуального summary на разблокированном телефоне:

```text
На сегодня 4 задачи. Самые ближайшие: позвонить врачу и проверить оплату.
```

Пример визуального статуса на заблокированном телефоне:

```text
Разблокируй телефон, чтобы я показала задачи.
```

### Стандартные визуальные статусы

Использовать короткие стандартные visual statuses. В первой версии это
toast/snackbar/card update, не TTS. Локальный cue `Готово` не заменяет
визуальный статус и проигрывается только после successful mutating
`executeAction`.

Для успешного создания задачи:

```text
Готово, задача сохранена.
```

Для покупки:

```text
Добавлено в покупки.
```

Для простого напоминания:

```text
Напоминание сохранено.
```

Для неуверенного времени:

```text
Я не уверена во времени. Поставить на завтра утром?
```

Для нескольких найденных задач:

```text
Нашла две похожие задачи. Какую перенести?
```

Для опасного действия:

```text
Не буду удалять без подтверждения.
```

Для команды, требующей разблокировки:

```text
Разблокируй телефон, чтобы продолжить.
```

Для неподдерживаемой команды:

```text
Пока я умею создавать задачи, добавлять покупки, переносить задачи и показывать план на сегодня или завтра.
```

### PlannerIntent

Все команды должны приводиться к единому объекту `PlannerIntent`.

Рекомендуемый тип первой версии:

```ts
type PlannerIntentType =
  | 'create_task'
  | 'add_shopping_item'
  | 'reschedule_task'
  | 'get_agenda'
  | 'clarify'
  | 'unsupported'

type PlannerIntent = {
  intent: PlannerIntentType

  rawText: string
  transcript?: string

  title?: string

  items?: Array<{
    title: string
    quantity?: string
  }>

  targetQuery?: string

  date?: string
  time?: string
  dateText?: string
  datePrecision?: 'exact' | 'date_only' | 'period' | 'relative' | 'unknown'

  reminderAt?: string

  priority?: 'low' | 'normal' | 'high'

  sphereId?: string
  sphereConfidence?: number

  recurrence?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval?: number
    until?: string
  }

  confidence: number
  needsConfirmation: boolean
  requiresUnlock?: boolean
  isDangerous?: boolean

  clarificationQuestion?: string
  alternatives?: string[]
}
```

Так как отдельной модели событий нет, `create_event` не добавлять в первую
версию.

Команда:

```text
завтра в 9 стоматолог
```

Должна возвращать:

```ts
const createTaskIntent = {
  intent: 'create_task',
  title: 'стоматолог',
  date: '2026-05-29',
  time: '09:00',
  datePrecision: 'exact',
  needsConfirmation: true,
  confidence: 0.9,
  rawText: 'завтра в 9 стоматолог',
}
```

Команда:

```text
через 10 минут выключить плиту
```

Должна возвращать:

```ts
const reminderTaskIntent = {
  intent: 'create_task',
  title: 'выключить плиту',
  reminderAt: '<now + 10 minutes>',
  datePrecision: 'relative',
  needsConfirmation: false,
  confidence: 0.95,
  rawText: 'через 10 минут выключить плиту',
}
```

Команда:

```text
добавь молоко и хлеб в покупки
```

Должна возвращать:

```ts
const shoppingIntent = {
  intent: 'add_shopping_item',
  items: [{ title: 'молоко' }, { title: 'хлеб' }],
  needsConfirmation: false,
  confidence: 0.95,
  rawText: 'добавь молоко и хлеб в покупки',
}
```

### Confirmation UI

Confirmation UI должен быть единым для Android и web.

Для задачи показывать:

- название
- дата
- время
- напоминание
- сфера
- приоритет
- кнопки: `Сохранить`, `Изменить`, `Отмена`

Для покупки показывать:

- список товаров
- список назначения: покупки
- кнопки: `Добавить`, `Изменить`, `Отмена`

Для переноса показывать:

- найденная задача
- старая дата
- новая дата
- кнопки: `Перенести`, `Отмена`

Для неуверенного распознавания показывать:

- исходный transcript
- возможные варианты
- уточняющий вопрос
- ручное редактирование

### Acceptance criteria

Считать пункт 3 реализованным, если:

1. `StubSpeechToTextService` больше не является production provider.
2. Добавлен `SpeechToTextService` interface.
3. Добавлен `BackendSpeechToTextService`.
4. Добавлен `CommandAudioRecorder`.
5. В wake-word mode запись команды стартует только после `WakeWordDetected`.
6. В wake-word mode до `WakeWordDetected` невозможен upload аудио.
7. Android отправляет аудио только на backend endpoint.
8. На Android-клиенте нет STT provider API keys.
9. Backend вызывает Yandex SpeechKit через server-side credentials.
10. Команда ограничена по длительности: max 8-10 секунд.
11. Перед upload есть локальная проверка:
    - duration >= 300-500 ms;
    - есть voice activity;
    - не тишина;
    - не слишком тихо.
12. Поддерживается PCM/LPCM 16 kHz mono 16-bit little-endian.
13. Backend возвращает transcript + `PlannerIntent` одним ответом.
14. Ошибки STT мапятся в понятные визуальные UI-сообщения.
15. При отсутствии интернета есть fallback: local STT stub или ручной ввод.
16. Raw audio не сохраняется по умолчанию.
17. Добавлены cost-control метрики.
18. Добавлена документация [docs/voice/stt-provider.md](voice/stt-provider.md).
19. В документации есть расчет стоимости:
    - 1 команда < 15 sec ≈ 0,1626 ₽;
    - beta 100 DAU × 5 команд/день ≈ 2 439 ₽/мес;
    - 1 000 DAU × 5 команд/день ≈ 24 390 ₽/мес.
20. В документации указано, что streaming STT не используется первым этапом из-за
    риска оплаты пустых/молчаливых сессий.
21. В первой версии не используется cloud TTS и динамический голосовой ответ.
22. Результат распознавания подтверждается визуально через confirmation UI.
23. После выполнения действия показывается визуальный статус:
    toast/snackbar/card update.
24. Android push-to-talk mode использует тот же `CommandAudioRecorder` и
    `BackendSpeechToTextService`, но source = `android_push_to_talk`.
25. Wake-word mode и push-to-talk mode покрыты разными тестами.
26. Auto-confirmed actions показывают visual result и `Undo`, если действие
    обратимое.
27. Backend hard limit для PCM 16 kHz mono 16-bit command audio: не больше
    400 KB.
28. Backend не доверяет `source` как security-гарантии, а использует auth, rate
    limit и duration/size validation.
29. При отсутствии сети после wake word показывается visual fallback: ручной
    ввод или повторить позже.
30. В коде отсутствуют вызовы TTS для результата STT/intent. Допустимы только
    локальные статические audio cues без приватного текста.
31. Голосовой ввод доступен только для глобальных `appRole = owner` и
    `appRole = test`.
32. Для `admin`, `user` и `guest` voice UI не показывает кнопку микрофона и не
    стартует Android wake-word service.
33. Backend `/api/voice/command` возвращает `403 voice_feature_forbidden` до
    вызова STT provider, если `appRole` не `owner` и не `test`.
34. Глобальная роль `test` имеет права обычного `user` плюс доступ к voice
    feature-gate.

## Как это работает простыми словами

На Android приложение держит небольшой фоновый сервис с постоянным
notification. Этот сервис слушает только короткую фразу активации через
локальный `WakeWordEngine`. Когда фраза сработала, приложение по умолчанию
сразу записывает короткую команду через `CommandAudioRecorder`, проверяет аудио
локально и передает валидный clip в `SpeechToTextService`. Production provider
отправляет аудио только на backend, где STT превращает речь в текст и сразу
запускает общий parser.

Если в админских настройках workspace включен режим дообучения wake word,
приложение перед записью команды открывает отдельное окно оценки срабатывания:
пользователь отмечает `Верно`, `Ложно`, `Пропустить` или открывает ручную запись
примера, а аудио-фрагмент сохраняется только при включенном разрешении на
сохранение. Если пользователь нажимает `Отмена`, текущий voice-flow завершается
и сервис возвращается к ожиданию wake word. Если пользователь нажимает
`Продолжить`, приложение переходит к обычной записи команды.

Кнопка микрофона внутри Android-приложения запускает тот же recorder и тот же
backend path как явный push-to-talk action. Privacy-инвариант `no audio before
wake word` относится к wake-word mode; для push-to-talk явным разрешением
считается нажатие пользователя.

Parser не выполняет действие сам. Он только превращает фразу в структурированное
намерение `PlannerIntent`: например `create_task`, `add_shopping_item`,
`reschedule_task` или `get_agenda`. Затем UI показывает карточку: что было
услышано, какое действие найдено, насколько parser уверен и нужно ли
подтверждение.

После подтверждения web/client action layer использует обычные существующие
механизмы Planner: создание задач идет через planner hooks, покупки идут через
shopping list hooks, перенос идет через task schedule API с `version` check.
Поэтому голосовой ввод не создает отдельный обходной путь записи данных и
соблюдает текущие правила авторизации, offline queue и синхронизации.

Текущий пункт 5 закрыт как v1 web/client action layer. Backend endpoints
`/voice/action/prepare` и `/voice/action/execute`, persistent preview storage,
production telemetry sink, Undo, auto-confirm и full clarification loop пока не
входят в реализованный слой.

Опасные действия вроде удаления, переноса, изменения повторяющейся задачи,
просмотра приватного расписания на заблокированном экране и массовых правок не
выполняются автоматически.

## План доведения до production-уровня

1. Зафиксировать целевое поведение.
   Статус: зафиксировано в разделе `Целевое поведение v1`. Следующие изменения
   parser, Android runtime и confirmation UI должны сверяться с этим разделом.

2. Реализовать wake-word provider для Android.
   Статус: реализован Android runtime-каркас за `WakeWordEngine`:
   `CustomTfliteWakeWordEngine`, fixed config `haotika`, assets manifest,
   MissingModel handling, metrics, native debug screen и tests. Для production
   release еще нужна реальная обученная модель `wakewords/haotika.tflite`.
   Provider выбран: внутренний `CustomWakeWordEngine` с Android runtime на
   TensorFlow Lite. Production engine - `CustomTfliteWakeWordEngine`, фраза одна
   и фиксированная: `Хаотика`, model path - `wakewords/haotika.tflite`.
   `MockWakeWordEngine` оставить для tests/dev. Не добавлять Picovoice как
   production dependency, не добавлять ONNX runtime в первую версию и не
   использовать Vosk как постоянно работающий wake-word engine. Подробности
   зафиксированы в [docs/voice/wake-word-provider.md](voice/wake-word-provider.md).

3. Подключить реальный STT после wake word.
   Статус: реализован и закрыт production feature-gate для `appRole = owner`
   и `appRole = test`. Production path:
   `WakeWordDetected` → `CommandAudioRecorder` →
   local audio validation → `BackendSpeechToTextService` →
   `POST /api/voice/command` → `YandexSpeechKitProvider` →
   `PlannerIntentParser` → transcript + `PlannerIntent`.

   При включенном админском режиме дообучения path временно расширяется:
   `WakeWordDetected` → `WakeWordTriggerReviewActivity` →
   `ContinueAfterWakeReview` → `CommandAudioRecorder` → обычный production path.

   `StubSpeechToTextService` оставлен только для tests/dev. Streaming STT и
   cloud TTS не входят в первую версию. Offline STT заложен архитектурно через
   `LocalSpeechToTextServiceStub`, но реальная offline-модель не входит в пункт 3.

   До публичного включения для остальных ролей нужно проверить реальные
   server-side credentials Yandex SpeechKit, `/api/voice/command` на
   устройстве/staging, cost-control метрики на реальных командах и отсутствие
   STT provider keys в Android-клиенте. Подробности зафиксированы в
   [docs/voice/stt-provider.md](voice/stt-provider.md).

4. Привести `PlannerIntentParser` к v1-контракту.
   Статус: реализован как parser layer.

   Parser принимает transcript + context и возвращает строго валидный
   `PlannerIntent` v1. Parser работает rule-first, поддерживает `create_task`,
   `add_shopping_item`, `reschedule_task`, `get_agenda`, `clarify` и
   `unsupported`.

   Parser не выполняет действия, не ищет задачи, не читает agenda и не пишет в
   базу. Реальное выполнение `create_task`, `add_shopping_item`,
   `reschedule_task` и `get_agenda` относится к пункту 5/action layer.

   Реализовано: v1 contract, schema validation, normalizer, date/time parsing,
   shopping items parsing, task title extraction, reschedule target extraction,
   agenda intent extraction, soft sphere resolution, dangerous delete handling,
   backend text-only LLM fallback hook, parser docs и tests.

   Backend LLM fallback заложен как интерфейсный hook только для текста.
   Production LLM provider для `PlannerIntentParser` пока не подключен. Базовые
   recurrence-сигналы в parser ограничены; полноценная семантика повторов и
   выполнение recurring actions относятся к action/model layer.

   Production LLM provider намеренно не входит в пункт 4. Пункт 4 закрывает
   deterministic parser contract и backend extension point; подключение
   реального provider нужно делать отдельным этапом после корпуса фраз и метрик,
   чтобы LLM не скрывал слабые места rule-parser.

5. Довести модель действий до v1.
   Статус: реализован v1 web/client action layer `PlannerActionExecutor` с
   контрактом `VoiceActionPreview` / `VoiceActionResult`.

   Реализовано: `create_task`, `add_shopping_item`, `get_agenda`,
   `reschedule_task`, `clarify`, `unsupported`; отдельные Event/Reminder не
   создаются; `reschedule_task` ищет candidates, обрабатывает `0 / 1 / 2+`,
   требует подтверждение и проверяет `version`; `get_agenda` учитывает locked
   screen и offline cache; `admin`/`user`/`guest` заблокированы, а `test` не
   получает admin-права. Подробности зафиксированы в
   [docs/voice/action-layer.md](voice/action-layer.md).

   Вне пункта 5:
   - backend `/voice/action/prepare` и `/voice/action/execute`, если понадобится
     server-side action orchestration;
   - persistent preview storage;
   - production telemetry sink;
   - Undo;
   - auto-confirm;
   - full clarification loop;
   - production LLM fallback provider;
   - Android end-to-end проверка action execution на реальном устройстве.

   Куда переходят deferred items:
   - full clarification loop - пункт 7, confirmation UI;
   - Undo - пункт 7, после понятной confirmation card и до включения
     auto-confirm;
   - auto-confirm - включать только после Undo и метрик качества, до закрытого
     тестирования;
   - production telemetry sink - пункт 13, метрики качества;
   - production LLM fallback provider - пункт 14, отдельный backend-only этап;
   - Android end-to-end action execution - пункты 15 и 16, закрытое тестирование
     и release gate;
   - backend `/voice/action/prepare` и `/voice/action/execute` + persistent
     preview storage - optional server-side action orchestration. Делать только
     после закрытого тестирования, если client-side preview/execute недостаточен
     для Android, multi-device, long-running или server-audited flows. Если это
     понадобится для публичного rollout, закрыть до пункта 16 release gate.

6. Добавить локальные voice cues `Слушаю` и `Готово`.
   Статус: реализовано для Android runtime. Локальные записи из `temp`
   подключены как `res/raw/voice_cue_listening_ru.m4a` и
   `res/raw/voice_cue_done_ru.m4a`; web остается визуальным без voice cues.
   Цель - добавить простую голосовую обратную связь без TTS, без cloud TTS и
   без динамического текста.

   Правила:
   - `Слушаю` играть после wake word detection и после явного Android
     push-to-talk start;
   - одновременно показывать overlay `Слушаю`;
   - запись команды начинать после cue или с pre-roll logic, чтобы cue не попал
     в STT;
   - `Готово` играть только после successful `executeAction` для
     `create_task`, `add_shopping_item` и `reschedule_task`;
   - не играть `Готово` для preview, confirmation-needed, blocked,
     `requiresUnlock`, `clarify`, `unsupported`, STT/parser/action errors,
     cancel и `get_agenda`.

   Технически: Android-only v1, web остается визуальным. Assets:
   `res/raw/voice_cue_listening_ru.*` и `res/raw/voice_cue_done_ru.*`. Нужен
   флаг или internal config `voiceCuesEnabled`, по умолчанию включенный на
   Android.

   Acceptance:
   - в коде нет TTS provider и cloud TTS;
   - cues локальные и не содержат приватных данных;
   - `Слушаю` проигрывается перед записью команды;
   - `Готово` проигрывается только после успешного изменения данных;
   - на locked screen не озвучиваются приватные данные;
   - есть tests/state checks: no `Готово` on preview/error/clarify/requiresUnlock.

7. Сделать подтверждение умнее.
   Карточка должна показывать понятное резюме: действие, название, дата, время,
   список или сфера, риск действия и причину подтверждения. Для опасных команд
   добавить более строгий текст подтверждения, например повторное нажатие или
   явную фразу. Для `clarify` добавить clarification loop: быстрые варианты
   типа действия, повтор микрофона, один уточняющий вопрос и безопасное
   сохранение во входящие после нескольких неудачных попыток.

   В этот же этап входит подготовка `Undo` для успешных mutating voice actions:
   `create_task`, `add_shopping_item`, `reschedule_task`. Auto-confirm остается
   выключенным, пока Undo не реализован и не покрыт тестами. После Undo можно
   включать auto-confirm allowlist только для safe intents:
   `add_shopping_item` и `create_task` с точным относительным `reminderAt`.

8. Добавить настройки помощника.
   В профиле или настройках приложения добавить включение/выключение Android
   wake word, язык распознавания, чувствительность wake word, разрешение
   фонового режима, режим подтверждений и ссылку на системные разрешения
   микрофона/notification. Добавить `voiceCuesEnabled`. Настройку выбора
   wake-фразы не добавлять: фраза активации одна и фиксированная - `Хаотика`.

9. Защитить приватность и безопасность.
   Проверить, что до wake word нет сетевой отправки аудио. Добавить явные
   privacy notes в UI и документацию. На backend ввести лимиты, audit events для
   голосовых действий, защиту от replay и запрет выполнения опасных intent без
   подтверждения. Для Android проверить поведение при отзыве microphone и
   notification permissions. Voice cue audio не содержит приватных данных;
   transcript/task titles не писать в metrics без отдельной policy.

10. Оптимизировать Android runtime.
    Измерить расход батареи и CPU в фоне, устойчивость foreground service после
    перезапуска приложения, поведение после reboot, Doze mode и vendor battery
    restrictions. Добавить graceful degradation: если wake word недоступен,
    оставить ручную кнопку микрофона. Проверить, что `Слушаю` не задерживает
    запись команды и не обрезает начало пользовательской фразы.

11. Улучшить web-режим.
    Обработать браузеры без Web Speech API, добавить понятные статусы
    `слушаю`, `распознаю`, `нужно повторить`, корректно показывать permission
    errors и не блокировать основной интерфейс. Wake word в web не добавлять,
    чтобы браузер не слушал микрофон в фоне. Web v1 не использует voice cues,
    только визуальные статусы.

12. Собрать корпус тестовых фраз.
    Создать набор команд на русском: короткие, длинные, с ошибками STT,
    разговорные, семейные, рабочие, покупки, даты и опасные действия. Покрыть
    parser unit tests, state machine tests, Android storage/plugin tests и UI
    tests карточки подтверждения. Добавить voice cue cases: `Слушаю` after wake
    detected / push-to-talk start, `Готово` only after success, no `Готово` for
    errors/clarify/requiresUnlock и no private voice output on locked screen.

13. Добавить метрики качества.
    Логировать только безопасные события без аудио: wake word detected,
    transcript received, intent type, confidence bucket, confirmation accepted,
    cancelled, failed. Нужны метрики false activation, failed recognition,
    parser clarify rate, confirmation accept rate и время от wake word до
    карточки. Добавить `voice_cue_listening_played`, `voice_cue_done_played`,
    `voice_cue_error`, время от wake detected до recorder start и время от
    execute success до visual result. На этом этапе подключается production
    telemetry sink для voice flow. Не логировать приватные task titles, raw
    transcript без отдельной policy и audio voice command.

14. Подключить production LLM fallback provider для `PlannerIntentParser`.
    Использовать существующий `BackendPlannerIntentFallback` только на backend.
    Provider получает только текстовый transcript, parser context, rule-parser
    result и v1 contract/schema. Audio в LLM не передается, client не хранит LLM
    keys и не вызывает LLM напрямую.

    LLM fallback включается только через feature flag для `appRole = owner` и
    `appRole = test`, после готовности action layer, confirmation UI, корпуса
    тестовых фраз и метрик качества. До этого `PlannerIntentParser` остается
    rule-first deterministic parser.

    LLM fallback можно использовать только для low-confidence safe parsing:
    сложные `create_task`, `add_shopping_item`, мягкая классификация сферы и
    safe-команды, где rule-parser вернул `clarify` или `unsupported`.

    LLM fallback нельзя вызывать для dangerous intent, delete/bulk actions,
    locked-screen sensitive flows, чтения приватных данных, команд
    `reschedule_task` на первом этапе и любых фраз, где deterministic precheck
    нашел опасные глаголы. LLM не может понизить уровень риска: если rule-parser
    вернул `isDangerous` или `requiresUnlock`, final intent сохраняет более
    строгие safety flags.

    Результат provider обязательно проходит `plannerIntentSchema` validation.
    Невалидный JSON, неподдерживаемый intent type (`create_event`,
    `create_reminder`, `delete`) или schema-invalid output игнорируется, а
    backend возвращает rule-parser result. При timeout/error provider также
    возвращается rule-parser result.

    Добавить metrics: `llm_fallback_requested`, `llm_fallback_used`,
    `llm_fallback_rejected_schema`, `llm_fallback_rejected_safety`,
    `llm_fallback_latency_ms`, `llm_fallback_provider_error` и оценку cost.
    Добавить timeout 2-3 секунды, rate limit и prompt/versioning.

15. Провести закрытое тестирование.
    Выпустить Android build для внутренней группы, собрать обратную связь по
    ложным срабатываниям, скорости, батарее, качеству команд и UX
    подтверждения. Отдельно проверить, не раздражают ли `Слушаю` и `Готово`, не
    мешает ли `Слушаю` STT и как cues ведут себя в silent/vibration mode.
    Прогнать Android end-to-end action execution на реальном устройстве:
    `create_task`, `add_shopping_item`, `get_agenda`, `reschedule_task`,
    locked-screen blocks и offline fallback. Отдельно сравнить режимы
    rule-parser only и rule-parser + LLM fallback, если пункт 14 включен для
    `owner/test`. По результатам обновить provider settings, parser rules, LLM
    fallback policy и тексты карточки.

16. Подготовить production release gate.
    Перед публичным релизом должны проходить lint, typecheck, web tests,
    Android unit tests, mobile sync/build и ручная проверка на реальном
    Android-устройстве. Release нельзя считать готовым, пока wake word работает
    локально, STT не раскрывает ключи, опасные действия требуют подтверждения,
    а offline/manual voice fallback корректно работает без сети. Gate для cues:
    local voice cues bundled and tested, no TTS/cloud TTS dependency, no dynamic
    spoken private data, no `Готово` for blocked/error/clarify flows. Если по
    итогам закрытого тестирования выбран server-side action orchestration, до
    release gate должны быть готовы backend `/voice/action/prepare`,
    `/voice/action/execute` и persistent preview storage.

17. После релиза улучшать по данным.
    Регулярно разбирать анонимизированные failure buckets, добавлять новые
    фразы в тестовый корпус, улучшать parser и обновлять документацию с
    реальными примерами команд. Отдельно отслеживать battery regressions и
    качество распознавания на разных устройствах. Отслеживать жалобы на voice
    cues, при необходимости добавить настройку отключения audio cues и не
    расширять статические cues в TTS без отдельного решения.

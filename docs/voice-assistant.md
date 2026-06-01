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
- запись идет через secure context + `getUserMedia` + `MediaRecorder`
- произносит команду
- web upload использует `source = web_push_to_talk`
- web v1 отправляет PCM/LPCM 16 kHz mono 16-bit little-endian, а не
  browser-native `audio/webm` blob
- команда преобразуется в тот же `PlannerIntent`
- используется тот же confirmation UI, что и на Android

Целевой Android wake-word provider первой версии - provider-aware слой за
интерфейсом `WakeWordEngine`. Primary path: LiveKit Wakeword обучает
`haotika.onnx`, Android запускает ее через `LiveKitOnnxWakeWordEngine` вместе с
LiveKit frontend models `melspectrogram.onnx` и `embedding_model.onnx`.
`CustomOnnxWakeWordEngine` остается для будущих raw-PCM ONNX моделей.
`CustomTfliteWakeWordEngine` остается fallback для будущего `haotika.tflite`, а
`MockWakeWordEngine` остается только для tests/dev. `WakeWordService` не должен
импортировать ONNX Runtime или LiteRT classes напрямую.

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
Производственная реализация подключается через `WakeWordEngineFactory` по
`provider` из manifest. В закрытом rollout primary provider - `CUSTOM_ONNX`.

Фиксированный model config:

```json
{
  "phraseId": "haotika",
  "displayPhrase": "Хаотика",
  "language": "ru-RU",
  "modelVersion": "haotika-livekit-0.1.0",
  "provider": "CUSTOM_ONNX",
  "modelPath": "wakewords/haotika.onnx",
  "inputKind": "embedding_matrix",
  "frontend": "livekit_openwakeword",
  "ioContractConfirmedForAndroid": false,
  "models": {
    "melspectrogram": "wakewords/livekit/melspectrogram.onnx",
    "embedding": "wakewords/livekit/embedding_model.onnx",
    "classifier": "wakewords/haotika.onnx"
  },
  "frontendConfig": {
    "embeddingWindowSize": 16,
    "embeddingSize": 96
  },
  "threshold": 0.65,
  "sampleRate": 16000,
  "vadEnabled": true,
  "runtime": {
    "frameMs": 80,
    "windowMs": 2000,
    "scoreSmoothing": true
  }
}
```

В закрытом обучающем rollout threshold должен браться только из
`wakewords/haotika_manifest.json`. Пользовательский override чувствительности в
UI временно не показывать и не применять, иначе статистика false accept /
false reject перестает быть сопоставимой между моделями.

Перед копированием первой реальной ONNX-модели нужно явно проверить model IO
contract: input/output names, shapes, dtypes, axis order, frame/window size,
sample rate, normalization, output score shape, score interpretation и threshold
semantics. Текущий Android raw-PCM ONNX engine поддерживает raw 16 kHz mono
PCM16 -> float32 `[-1, 1]`, но LiveKit export является classifier head и ожидает
embeddings `(batch, 16, 96)`.
Для LiveKit classifier Android использует отдельный `LiveKitOnnxWakeWordEngine`:
`melspectrogram.onnx` -> `embedding_model.onnx` -> `haotika.onnx`. До parity
test против Python `WakeWordModel` manifest должен оставлять
`ioContractConfirmedForAndroid: false`, а `haotika.onnx` нельзя считать approved
Android model.

Для `haotika-livekit-0.1.0` Android/Python parity пройден локально. Эта версия
принята только как `bootstrap_collection` model с threshold `0.50`: ее задача -
собирать реальные `false_accept` и `false_reject`, а не быть production-quality
моделью.

Первый parity baseline закреплен на `livekit/livekit-wakeword` commit
`1ec7f680df30ff4ca0ebae6b5983441e94b10980`. Если меняется LiveKit commit или
frontend ONNX hashes, Android/Python parity нужно прогнать заново. Rolling
embeddings должны идти в classifier в том же порядке, что в Python:
последние 16 embeddings, oldest-to-newest. Raw audio, raw mel values и raw
embeddings нельзя логировать в metrics.

Parity запускается локально по инструкции
`tools/wakeword-training/parity/scripts/run_android_parity_check.md`: Python
сначала генерирует expected score JSON для тех же WAV, затем Android
instrumented test сравнивает score через offline `LiveKitOnnxOfflineScorer`.
Если fixtures/model files отсутствуют, это не считается pass.

Если модели из `modelPath` нет в assets, provider engine должен вернуть
`MissingModel` error, а не падать. При отсутствующей wake-word модели
push-to-talk fallback остается доступен.

Первый честный training loop для ONNX:

```bash
cd tools/wakeword-training
./scripts/train_livekit.sh haotika-livekit-0.1.0
./scripts/evaluate_model.py \
  --version haotika-livekit-0.1.0 \
  --model output/haotika-livekit-0.1.0/haotika.onnx \
  --positive data/validation/positive \
  --negative data/validation/negative \
  --out output/haotika-livekit-0.1.0
./scripts/copy_to_android_assets.sh haotika-livekit-0.1.0
```

`copy_to_android_assets.sh` обязан падать без `approval.json`; approval нельзя
генерировать автоматически из evaluation.

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

Для закрытого тестирования на странице настроек голосового помощника есть
workspace-режим дообучения wake word. Если он включен, между wake word и записью команды
добавляется отдельный временный шаг оценки:

1. Открыть отдельное окно оценки срабатывания wake word.
2. Показать варианты `Прослушать фрагмент`, `Верно`, `Ложно`, `Пропустить`,
   `Записать` и чекбокс разрешения на сохранение короткого аудио-примера
   wake-фразы.
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
- если пользователь нажал Undo;
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

Пользовательской настройки языка распознавания нет. На первом этапе runtime
всегда использует русский язык по умолчанию:

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
→ добавить item “Молоко” в покупки
→ показать visual status “Добавлено в покупки.”
```

Для нескольких товаров:

```text
“добавь хлеб, молоко и яблоки в покупки”
→ создать 3 shopping items
```

Перед добавлением покупка нормализуется: первое буквенное значение в названии
становится заглавным. Если такая активная покупка уже есть в разделе “Нужно
купить”, новая запись не создается и показывается статус “Уже есть”. Если
совпадение найдено в разделе “Куплено”, action layer возвращает покупку в
активный список.

Для запроса списка покупок:

```text
“что надо купить?”
“что в списке покупок?”
→ показать активные shopping items из раздела “Нужно купить”
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
обратимое. В v1 `Undo` уже реализован в confirmation UI, но auto-confirm все
еще выключен до метрик качества и закрытого тестирования; runtime остается в
режиме confirmation-first.

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
Пока я умею создавать задачи, добавлять покупки, показывать список покупок, переносить задачи и показывать план на сегодня или завтра.
```

### PlannerIntent

Все команды должны приводиться к единому объекту `PlannerIntent`.

Рекомендуемый тип первой версии:

```ts
type PlannerIntentType =
  | 'create_task'
  | 'add_shopping_item'
  | 'get_shopping_list'
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
  timeShiftMinutes?: number
  timeShiftText?: string
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

Команда:

```text
перенеси задачу помыть окна на час раньше
```

Должна возвращать:

```ts
const relativeRescheduleIntent = {
  intent: 'reschedule_task',
  targetQuery: 'помыть окна',
  timeShiftMinutes: -60,
  timeShiftText: 'на час раньше',
  datePrecision: 'relative',
  isDangerous: true,
  needsConfirmation: true,
  confidence: 0.83,
  rawText: 'перенеси задачу помыть окна на час раньше',
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
- новая дата/время или относительный сдвиг (`на час раньше`, `на 15 минут позже`)
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
10. Команда ограничена по длительности: max 8 секунд.
11. Перед upload есть локальная проверка:
    - duration >= 500 ms;
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

Если в настройках голосового помощника включен workspace-режим дообучения wake word,
приложение перед записью команды открывает отдельное окно оценки срабатывания:
пользователь может предварительно прослушать фрагмент, отмечает `Верно`, `Ложно`,
`Пропустить` или открывает ручную запись примера, а аудио-фрагмент сохраняется
только при включенном разрешении на сохранение. В ручной записи пример
сохраняется только после отдельного прослушивания. Если пользователь нажимает
`Отмена`, текущий voice-flow завершается
и сервис возвращается к ожиданию wake word. Если пользователь нажимает
`Продолжить`, приложение переходит к обычной записи команды.

Кнопка микрофона внутри Android-приложения запускает тот же recorder и тот же
backend path как явный push-to-talk action. Privacy-инвариант `no audio before
wake word` относится к wake-word mode; для push-to-talk явным разрешением
считается нажатие пользователя.

Parser не выполняет действие сам. Он только превращает фразу в структурированное
намерение `PlannerIntent`: например `create_task`, `add_shopping_item`,
`get_shopping_list`, `reschedule_task` или `get_agenda`. Затем UI показывает
карточку: что было
услышано, какое действие найдено, насколько parser уверен и нужно ли
подтверждение.

После подтверждения web/client action layer использует обычные существующие
механизмы Planner: создание задач идет через planner hooks, покупки идут через
shopping list hooks, перенос идет через task schedule API с `version` check.
Поэтому голосовой ввод не создает отдельный обходной путь записи данных и
соблюдает текущие правила авторизации, offline queue и синхронизации.

Текущий пункт 5 закрыт как v1 web/client action layer. Backend endpoints
`/voice/action/prepare` и `/voice/action/execute`, persistent preview storage,
production telemetry sink и auto-confirm пока не входят в реализованный слой.
Undo и full clarification loop были вынесены из пункта 5 и реализованы в
пункте 7 как часть confirmation UI.

Опасные действия вроде удаления, переноса, изменения повторяющейся задачи,
просмотра приватного расписания на заблокированном экране и массовых правок не
выполняются автоматически.

## План доведения до production-уровня

1. Зафиксировать целевое поведение.
   Статус: зафиксировано в разделе `Целевое поведение v1`. Следующие изменения
   parser, Android runtime и confirmation UI должны сверяться с этим разделом.

2. Реализовать wake-word provider для Android.
   Статус: Android runtime-каркас provider-aware. Primary engine -
   `CustomOnnxWakeWordEngine` с `wakewords/haotika.onnx`; fallback engine -
   `CustomTfliteWakeWordEngine` с `wakewords/haotika.tflite`;
   `MockWakeWordEngine` оставить для tests/dev. Фраза одна и фиксированная:
   `Хаотика`. MissingModel handling, safe metrics, native debug screen и tests
   должны оставаться за интерфейсом `WakeWordEngine`. Не добавлять Picovoice как
   production dependency, cloud wake word или Vosk как постоянно работающий
   wake-word engine. Подробности зафиксированы в
   [docs/voice/wake-word-provider.md](voice/wake-word-provider.md) и
   [docs/voice/wake-word-training.md](voice/wake-word-training.md).

3. Подключить реальный STT после wake word.
   Статус: реализован и закрыт production feature-gate для `appRole = owner`
   и `appRole = test`. Production path:
   `WakeWordDetected` → `CommandAudioRecorder` →
   local audio validation → `BackendSpeechToTextService` →
   `POST /api/voice/command` → `YandexSpeechKitProvider` →
   `PlannerIntentParser` → transcript + `PlannerIntent`.

   При включенном workspace-режиме дообучения path временно расширяется:
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
   `add_shopping_item`, `get_shopping_list`, `reschedule_task`, `get_agenda`,
   `clarify` и `unsupported`.

   Parser не выполняет действия, не ищет задачи, не читает agenda и не пишет в
   базу. Реальное выполнение `create_task`, `add_shopping_item`,
   `get_shopping_list`, `reschedule_task` и `get_agenda` относится к пункту
   5/action layer.

   Реализовано: v1 contract, schema validation, normalizer, date/time parsing,
   shopping items parsing, shopping list query extraction, task title
   extraction, reschedule target extraction, relative reschedule shifts
   (`timeShiftMinutes`), agenda intent extraction, soft sphere resolution,
   dangerous delete handling, backend text-only LLM fallback hook, parser docs
   и tests.

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

   Реализовано: `create_task`, `add_shopping_item`, `get_shopping_list`,
   `get_agenda`, `reschedule_task`, `clarify`, `unsupported`; отдельные
   Event/Reminder не
   создаются; `reschedule_task` ищет candidates, обрабатывает `0 / 1 / 2+`,
   поддерживает перенос на новую дату/время и относительный сдвиг
   `timeShiftMinutes` от текущего времени выбранной задачи, требует
   подтверждение и проверяет `version`; если у задачи нет даты/времени для
   относительного сдвига, action layer возвращает уточнение вместо записи.
   `get_agenda` и `get_shopping_list` учитывают locked screen;
   `admin`/`user`/`guest` заблокированы, а `test` не получает admin-права.
   Подробности зафиксированы в
   [docs/voice/action-layer.md](voice/action-layer.md).

   Вне пункта 5:
   - backend `/voice/action/prepare` и `/voice/action/execute`, если понадобится
     server-side action orchestration;
   - persistent preview storage;
   - production telemetry sink;
   - auto-confirm;
   - production LLM fallback provider;
   - Android end-to-end проверка action execution на реальном устройстве.

   Куда переходят deferred items:
   - auto-confirm - включать только после метрик качества и закрытого
     тестирования; этап 7 оставляет runtime в confirmation-first режиме;
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
   Статус: реализован v1 smart confirmation UI между
   `PlannerActionExecutor.prepareAction()` и `executeAction()`.

   Реализовано: единая `VoiceConfirmationCard` для `VoiceActionPreview`,
   action-specific layouts для `create_task`, `add_shopping_item`,
   `get_shopping_list`, `reschedule_task`, `get_agenda`, `clarify`,
   `unsupported`, `blocked`, `not_found`, `multiple_candidates` и
   `requires_unlock`; показ transcript
   там, где это безопасно; причина подтверждения и confidence; строгая кнопка
   `Да, перенести` для dangerous `reschedule_task`; locked-screen UI без
   приватных данных; clarification loop v1 с быстрыми вариантами, ручным
   редактированием, повтором микрофона и лимитом попыток; visual result и
   `Undo` для successful mutating voice actions.

   `Undo` реализован через `PlannerActionExecutor.undoAction()`:
   `create_task` удаляет созданную задачу существующим planner remove flow,
   `add_shopping_item` удаляет созданные shopping items существующим shopping
   remove flow, `reschedule_task` восстанавливает previous schedule через
   `taskClient.setTaskSchedule` с `expectedVersion`.

   Cleanup перед пунктом 8 зафиксирован: Undo является ephemeral UI action в
   текущей карточке с TTL 30 секунд; failed Undo показывает visual-only
   `Не удалось отменить. Обнови экран.`; Undo не проигрывает cue `Готово`;
   после successful/failed Undo payload не используется повторно; `reschedule`
   Undo offline заблокирован без свежей версии задачи. Edit flow не вызывает
   `executeAction()` до повторного подтверждения, а `multiple_candidates`
   передает выбранные `candidateTaskId` и `expectedVersion`.

   Android parity: Android runtime использует тот же web/client
   `VoiceConfirmationCard` через Capacitor WebView. Native layer отвечает за
   wake word, запись, STT bridge и local static cues, но не имеет отдельного
   native confirmation overlay и не выполняет planner/shopping actions напрямую.

   Auto-confirm намеренно остается выключенным. Следующий шаг для auto-confirm -
   метрики качества и закрытое тестирование; allowlist по-прежнему ограничен
   safe intents: `add_shopping_item` и `create_task` с точным относительным
   `reminderAt`. Подробности зафиксированы в
   [docs/voice/confirmation-ui.md](voice/confirmation-ui.md).

7.1. Закрыть хвосты confirmation UI перед настройками.
Статус: выполнено как cleanup пункта 7.

Зафиксировано и проверено:

- Undo failure behavior;
- Undo TTL / ephemeral nature;
- отсутствие cue `Готово` после Undo;
- глобально выключенный auto-confirm runtime;
- edit flow без выполнения до подтверждения;
- `multiple_candidates` с `candidateTaskId + expectedVersion`;
- roadmap: Undo больше не deferred из пункта 5;
- Android parity через общий WebView UI.

8. Добавить настройки помощника.
   Статус: реализовано в настройках голосового помощника. Есть master toggle,
   Android wake word toggle, background wake word toggle, чувствительность,
   `voiceCuesEnabled`, режим дообучения wake word, permission rows для
   microphone/notifications и ссылки в системные настройки приложения/батареи.

   Настройка языка распознавания не добавляется: русский используется по
   умолчанию. Настройка выбора wake-фразы не добавляется: фраза активации одна и
   фиксированная - `Хаотика`.

9. Защитить приватность и безопасность.
   Технически закрепить privacy/security-инварианты voice flow без добавления
   новых intents и без изменения parser/action logic. До `WakeWordDetected` в
   wake-word mode нет upload, push-to-talk требует явного user action, backend
   требует auth/source/security headers, raw audio не сохраняется, metrics/audit
   не содержат transcript/task titles/audio, locked screen scrubber скрывает
   приватные данные, dangerous intent требует confirmation, Android корректно
   обрабатывает revoke microphone/notification permissions. Replay protection
   имеет TTL/clock-skew checks, duplicate `requestId` отклоняется после
   successful и failed попыток, rate limit учитывает user/device/IP, redaction
   рекурсивно чистит nested private payloads. Подробности:
   [docs/voice/privacy-security.md](voice/privacy-security.md).

10. Оптимизировать Android runtime.
    Статус: реализован Android runtime status/error/metrics layer,
    owner/test debug UI, graceful degradation, `START_NOT_STICKY` behavior,
    no automatic microphone listening after reboot, bounded wake ring buffer
    cleanup и timing checks для cue `Слушаю`.

    Runtime metrics остаются safe: без audio, transcript, task titles, shopping
    item names, agenda content и candidate titles. Missing wake model блокирует
    wake word, но оставляет push-to-talk fallback доступным при наличии
    microphone permission. `Слушаю` проигрывается до старта recorder и не
    загружается как command audio; cue-only audio блокируется local validation.

    Battery/CPU/memory samples доступны в debug/status UI. Doze, screen-off,
    reboot и vendor battery restrictions зафиксированы как manual Android device
    matrix перед rollout. Подробности:
    [docs/voice/android-runtime.md](voice/android-runtime.md).

11. Улучшить web-режим.
    Статус: реализовано.

    Web Speech API больше не используется как primary path. Web flow идет через
    explicit mic click -> secure context + `getUserMedia` + `MediaRecorder` ->
    Web Audio PCM validation -> `/api/voice/command` с
    `source = web_push_to_talk` -> `VoiceConfirmationCard`.

    Обработаны браузеры без secure context, `getUserMedia` или
    `MediaRecorder`; добавлены визуальные states `listening`, `recognizing`,
    `needs_repeat`, `permission_denied`, `unsupported`, `error`; permission
    errors показываются как понятные сообщения; основной интерфейс не
    блокируется. Wake word в web не добавлен, web v1 не использует voice cues и
    не использует TTS/cloud TTS. Upload format v1: PCM/LPCM 16 kHz mono 16-bit
    little-endian (`Content-Type: audio/l16`); browser `audio/webm`/opus blob не
    входит в текущий контракт. Подробности: [docs/voice/web-mode.md](voice/web-mode.md).

11.1. Закрыть web-mode cleanup.
Статус: реализовано.

    Roadmap wording привязан к реальным prerequisites:
    secure context/getUserMedia/MediaRecorder. Web upload format зафиксирован
    как PCM/LPCM client-side normalization; safe metrics зафиксированы без
    transcript/audio/task titles/shopping item names; добавлен browser
    compatibility checklist. Backend normalization `webm_opus` остается
    отдельным будущим вариантом и должен явно разрешаться только для
    `source = web_push_to_talk`.

12. Собрать корпус тестовых фраз.
    Статус: реализовано.

    Добавлен shared machine-readable corpus `voice-command-corpus.v1` в
    `packages/contracts/src/voice-test-corpus`: 195 cases на русском для
    wake-word hard negatives, create_task, reminderAt, shopping, agenda,
    reschedule, clarify, unsupported/dangerous, locked-screen, STT/noisy
    transcript, voice cues, web flow, Android runtime и privacy/security.

    Корпус содержит fixed context, locked/role contexts, schema validation,
    coverage minimums by category, `plannerIntentSchema` validation для всех
    `expectedIntent`, parser baseline tests, action preview tests, confirmation
    UI subset tests, web flow validation tests, voice cue/privacy/metrics
    expectations. Подробности: [docs/voice/test-corpus.md](voice/test-corpus.md).

12.1. Закрепить corpus maintenance policy.
Статус: реализовано.

    Правило поддержки: новый баг голосового ввода -> сначала новый case в
    `voice-command-corpus.v1` -> затем fix в parser/action/UI/runtime. Новая
    deterministic normalization, dangerous формулировка, STT-ошибка,
    locked-screen сценарий или web validation edge case также добавляются через
    corpus case. Все `expectedIntent` проходят `plannerIntentSchema`, все
    locked/private cases имеют `mustNotShow`/`mustNotLog`, voice cues покрывают
    `Слушаю`/`Готово`, а future LLM eligibility явно задается через
    `llmFallbackAllowed`.

13. Добавить метрики качества.
    Статус: реализовано как два слоя.

    Offline report `npm run voice-quality-report` прогоняет
    `voice-command-corpus.v1` на 195 cases через `PlannerIntentParser`,
    `PlannerActionExecutor.prepareAction`, confirmation UI/web/voice cue/privacy
    expectations и группирует результаты по category. Safety thresholds hard
    fail: `dangerous_block_rate`, `locked_screen_privacy_pass_rate`,
    `voice_cue_policy_pass_rate`, `llm_eligibility_policy_pass_rate` и
    `no_private_metrics_policy` должны быть 100%.

    Runtime safe telemetry добавляет typed `SafeVoiceMetricEvent`,
    `VoiceMetricsSink`, client `BackendVoiceMetricsSink`, backend
    `ApiVoiceMetricsSink` и endpoint `POST /api/voice/metrics`. Endpoint
    принимает один event до 16 KB, rate-limit по actor/device/IP, reject unknown
    event names/fields, recursive private payloads и full intent/preview/result.
    Не логировать audio, raw transcript, task titles, shopping item names,
    agenda content или candidates. Метрики собираются для подготовки
    auto-confirm, но не включают auto-confirm; auto-confirm появится только
    после закрытого тестирования и отдельного решения. Подробности:
    [docs/voice/quality-metrics.md](voice/quality-metrics.md).

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
    `create_task`, `add_shopping_item`, `get_shopping_list`, `get_agenda`,
    `reschedule_task`, locked-screen blocks и offline fallback. Отдельно сравнить режимы
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

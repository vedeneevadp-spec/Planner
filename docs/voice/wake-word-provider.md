# Wake-Word Provider

Документ фиксирует production-подход для Android wake word в голосовом
помощнике Chaotika Planner.

## Решение v1

Wake-фраза в первой версии только одна:

```text
Хаотика
```

Пользователь не выбирает wake-фразу, не задает собственную фразу и не меняет ее
в настройках. Это намеренное ограничение первой версии: одна фраза проще
тестируется, стабильнее измеряется по false accept / false reject и не требует
динамического обучения моделей на устройстве.

Выбранный provider:

- primary provider: внутренний `CustomWakeWordEngine`
- Android runtime: LiteRT v2.1.x через `com.google.ai.edge.litert:litert:2.1.5`
- production engine: `CustomTfliteWakeWordEngine`
- model file: `wakewords/haotika.tflite`
- tests/dev engine: `MockWakeWordEngine`

Проект использует `minSdkVersion = 24`, поэтому LiteRT v2.1.x допустим: для
Android v2.1.x Google указывает min SDK 23. Версия `2.1.5` выбрана как latest в
линейке v2.1.x; `2.1.0` не использовать, потому что она уже legacy.

Текущий статус реализации: Android runtime-каркас добавлен за интерфейсом
`WakeWordEngine`. Локально можно обучить экспериментальную модель
`haotika.tflite`, но она не считается production-ready и исключена из git. Если
asset `wakewords/haotika.tflite` отсутствует, release runtime должен вернуть
`MissingModel`, а debug/dev может использовать `MockWakeWordEngine`.

Не использовать в production v1:

- Picovoice как production dependency
- ONNX runtime
- Vosk как постоянно работающий wake-word engine

## Архитектура

`WakeWordService` должен зависеть только от интерфейса `WakeWordEngine`.
Сервис не должен импортировать TensorFlow Lite classes и не должен знать, как
устроен inference.

Целевые модели слоя wake word:

- `WakeWordConfig`
- `WakeWordDetection`
- `WakeWordError`
- `WakeWordListener`
- `WakeWordMetricsLogger`

Целевые реализации:

- `MockWakeWordEngine` - tests/dev, без реального аудио inference
- `CustomTfliteWakeWordEngine` - production Android runtime

Поток работы:

```text
microphone frames
→ in-memory ring buffer
→ VAD
→ TFLite inference
→ WakeWordDetection
→ pause wake-word listening
→ sound + vibration + overlay
→ command recording
```

До wake word аудио не отправляется на сервер. Ring buffer хранится только в
памяти и не пишется на диск.

## Fixed Config

Конфиг модели фиксированный:

```json
{
  "phraseId": "haotika",
  "displayPhrase": "Хаотика",
  "language": "ru-RU",
  "modelVersion": "haotika-realworld-20260528-213500",
  "modelPath": "wakewords/haotika.tflite",
  "threshold": 0.85,
  "sampleRate": 16000,
  "vadEnabled": true
}
```

`threshold = 0.85` - текущий экспериментальный порог после дообучения на
real-world `true_accept` / `false_accept`. Он выбран консервативнее training
recommendation, чтобы сильнее снизить false accept. Перед production release его нужно
уточнить на большем тестовом корпусе и реальных устройствах.

## Assets

В Android assets нужны placeholder-файлы:

```text
app/src/main/assets/wakewords/README.md
app/src/main/assets/wakewords/haotika_manifest.json
```

Файл `haotika.tflite` можно держать локально для тестов на устройстве, но не
коммитить model files в репозиторий без отдельного product/security решения.

Если `wakewords/haotika.tflite` отсутствует, `CustomTfliteWakeWordEngine`
должен вернуть `MissingModel` error, а не падать.

## Ошибки

Production implementation должна обрабатывать:

- `MissingModel`
- `InvalidModelManifest`
- `MicrophonePermissionDenied`
- `ForegroundServiceNotAllowed`
- `TfliteRuntimeInitError`
- `InferenceError`

Ошибки wake-word слоя не должны приводить к выполнению пользовательской команды.
Если wake word недоступен, приложение должно оставить ручной запуск по кнопке
микрофона.

## Metrics

`WakeWordMetricsLogger` должен логировать только безопасные события без аудио:

- `wake_detected`
- `true_accept_reported`
- `false_accept_reported`
- `false_reject_reported`
- `training_example_saved`
- `model_missing`
- `service_start_error`
- `inference_error`

Минимальные quality metrics:

- false accept rate
- false reject rate
- средний score при корректной активации
- средний score на негативных примерах
- время от фразы до detection
- расход CPU/battery в foreground service
- стабильность на заблокированном экране и в фоне

## Debug Screen

Для внутренней проверки нужен Android debug screen:

- phrase
- model version
- threshold
- current score
- last detection score
- detection count
- кнопка `false accept`
- кнопка `false reject`

False accept - помощник сработал без фразы `Хаотика`. False reject - пользователь
произнес `Хаотика`, но помощник не сработал.

## Real-World Sample Collection

Для улучшения модели в приложении есть opt-in режим сбора реальных примеров.
По умолчанию он выключен.

На Android экран доступен из постоянного notification голосового помощника по
кнопке `Примеры`.

Текст согласия:

```text
Помочь улучшить распознавание “Хаотика”
Разрешаю сохранять короткие примеры wake-фразы
```

Правила privacy:

- до wake word аудио не пишется на диск и не отправляется на сервер;
- после wake word короткий фрагмент держится только в памяти;
- на диск он сохраняется только если пользователь заранее включил opt-in и
  явно нажал `Верно`, `Ложно` или `Записать`;
- `Пропустить` очищает pending-фрагмент и не сохраняет пример для обучения;
- `Записать` открывает утилиту записи фразы `Хаотика` с trim/normalize/validation
  и сохраняет успешную запись как
  positive sample с label `false_reject`;
- загрузка на сервер не реализована;
- файлы лежат только в app-specific storage Android.

После срабатывания пользователь может отметить:

```text
Это было правильное срабатывание?
[Верно] [Ложно] [Пропустить] [Записать]
```

При сохранении создаются:

- WAV-файл 16 kHz mono PCM16 с коротким фрагментом 1-2 секунды;
- JSON metadata рядом с WAV.

Metadata содержит:

- `label`: `true_accept`, `false_accept` или `false_reject`;
- score модели;
- threshold;
- model version;
- device model;
- Android SDK;
- sample rate и duration;
- оценку шума `noiseLevelRms` / `noiseLevelDbfs`.

Локальный путь:

```text
/sdcard/Android/data/ru.chaotika.app/files/wakeword/haotika/real-world/
```

Маппинг для обучения:

- `true_accept` -> positive samples;
- `false_reject` -> positive samples, потому что пользователь произнес
  `Хаотика`, но модель не сработала;
- `false_accept` -> hard negative samples;
- `skipped` / `Пропустить` -> не использовать в обучении.

## Training Pipeline

Обучение модели не выполняется внутри Android app.

Экспериментальный локальный пайплайн:

```bash
.wakeword-venv/bin/python scripts/wakeword-train-haotika.py --install-asset
```

Он использует локальные positive recordings и open negative samples из Google
mini Speech Commands (`CC-BY-4.0`). Результат складывается в
`datasets/wakeword/haotika/training/haotika-experimental-v0/`, а `.tflite`
копируется в `android/app/src/main/assets/wakewords/haotika.tflite` для теста
на устройстве.

Training pipeline должен жить отдельно от мобильного приложения и включать:

- сбор положительных примеров фразы `Хаотика` разными голосами
- сбор негативных примеров: похожие слова, шум, бытовая речь, музыка, фоновые
  разговоры
- аугментации: шум, реверберация, разные микрофоны, расстояние до телефона
- train/validation/test split без пересечения дикторов между выборками
- подбор threshold по false accept / false reject
- export в TensorFlow Lite
- генерацию `haotika_manifest.json` с версией модели и параметрами аудио

Перед production release модель нужно проверять на реальных Android-устройствах,
в фоне, на заблокированном экране и при разных уровнях шума.

## Tests

Минимальный набор тестов для реализации:

- `MockWakeWordEngine` emits detection в tests/dev
- `WakeWordService` зависит от `WakeWordEngine` interface
- отсутствие `haotika.tflite` возвращает `MissingModel`
- state machine переходит `LISTENING_WAKE_WORD -> WAKE_WORD_DETECTED`
- после detection service приостанавливает wake-word listening
- inference error не запускает command recording

# Аудит остаточных упоминаний

Поиск выполнялся через `rg` и `git ls-files` до и после удаления, включая
динамические импорты, package exports, scripts/CI, Android source assets,
игнорируемые локальные модели и актуальные сборочные артефакты.

Шаблоны: voice, VoiceAssistant, speech, STT, wakeword/wake_word/WakeWord,
microphone, MediaRecorder, getUserMedia, AudioRecord, RECORD_AUDIO,
ONNX, TFLite, LiteRT, LiveKit и оба имени удалённых настроек.
Alice/OAuth/ALICE_/oauth_authorization_codes проверены отдельно.

| Остаток                                                                        | Класс                        | Причина сохранения                                                                |
| ------------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------- |
| `modules/alice`, OAuth routes/repository/SQL, ALICE_* и общие Yandex-параметры | 1. Алиса                     | Действующий внешний навык, привязка и LLM                                         |
| `source='voice'` в chaos-inbox contract, DB schema, seed и тестах              | 1/2/5                        | Новые покупки Алисы и исторические данные, backup/sync                            |
| `formatTaskForSpeech` / `formatDateForSpeech` в Alice routes                   | 1                            | Ответы внешнего навыка                                                            |
| MicIcon в общем UI catalog                                                     | 2. Общая функция             | Пользовательские сохранённые значения иконки                                      |
| `app_role='test'`                                                              | 2/3                          | Существующая роль, не голосовая feature                                           |
| Исторические migrations 000048/000051 и другие старые SQL с voice columns      | 3. История                   | Полная цепочка создания/восстановления; checksum не изменён                       |
| Старые audits/release notes/time audits                                        | 4. Историческая документация | Не переписывались                                                                 |
| docs/voice-assistant.md и docs/voice/*.md                                      | 4                            | Помечены архивными; не инструкции текущего runtime                                |
| session.legacy-preferences.ts и deprecated OpenAPI booleans                    | 5. Совместимость             | Только false в ответах, известные boolean inputs игнорируются                     |
| packages/contracts/src/backup.ts                                               | 5                            | Два известных legacy-поля принимаются строго и удаляются до SQL                   |
| Web cleanupRetiredVoiceStorage и main.tsx вызов                                | 6. Миграция очистки          | Удаление ровно двух прежних storage keys                                          |
| PlannerAppUpgradeCleanup: имя WakeWordService, planner.voice.*, opt-in/channel | 6                            | Остановка старого имени и точечное удаление старого состояния; класса service нет |
| Новая миграция 000106 и migration/legacy/regression tests                      | 5/6                          | Проверка удаления и сохранности данных                                            |
| `.gitignore`, ESLint/Knip excludes для training data/venv/output               | 2/5                          | Не раскрывать и не включать личные аудио/датасеты                                 |
| Android aapt ignoreAssetsPattern для wakewords/.onnx/.tflite                   | 6                            | Запрет случайного повторного включения локальных моделей                          |
| Web bundle guard, retired route tests, microphone=() check                     | 6                            | Запрет поставки старого runtime и записи микрофона                                |
| `invoice`, `lastTimestamp`, `ghostTask` при широком поиске `voice`/`stt`       | 2                            | Лексические совпадения без связи с распознаванием                                 |

Найденные активные исходники не импортируют удалённые модули, не вызывают
удалённый native plugin, не обращаются к удалённым столбцам. API SQL-каталог
после миграции не содержит runtime-функций с обращением к этим столбцам.
Старые столбцы встречаются только в истории/compatibility/cleanup tests.

Новые `apps/api/dist`, `apps/web/dist`, synced Android web assets проверены
на `VOICE_STT_`, `YandexSpeechKitProvider`, `VoiceCommandService`,
`stt.api.cloud.yandex.net`, `/api/voice/`: совпадений нет. Web budget guard
дополнительно проверяет **все** JS chunks на `PlannerVoiceAssistant`,
`getUserMedia`, `MediaRecorder`, retired endpoints и прежние имена chunks.

APK audit: нет удалённых DEX-классов, моделей, голосовых звуков, старых web
chunks, ONNX/LiteRT libraries и microphone permissions. Осталась только
общая `libdatastore_shared_counter.so` для четырёх ABI. Строка имени
WakeWordService в upgrade cleanup не является определением DEX-класса.

Ignored training datasets, личные samples и старые локальные experiment
outputs сохранены вне current build inputs. Исторический корневой `dist`
(апрель 2026) не используется Capacitor: `webDir` — `apps/web/dist`.

Класс 7 — пропущенный действующий встроенный ввод: **не обнаружен**.

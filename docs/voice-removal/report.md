# Удаление встроенного голосового ввода — итоговый отчёт

Этот отчёт фиксирует локальную реализацию. Подготовка отдельного выпуска
1.1.20 описана в [release-1.1.20.md](release-1.1.20.md).

Дата: 18 сентября 2026 года. Изменения выполнены локально, без коммита,
production-деплоя, применения миграций к рабочей БД или публикации APK.
Исходная ветка: `codex/today-quiet-refresh-1.1.19`,
HEAD: `2b40273eca2238e5ae7b89b0b514f00825b45676`. Рабочее дерево было чистым.

Встроенный runtime удалён из исходников и проверенных web/Android
артефактов. Алиса, её конфигурация и OAuth сохранены. Полная приёмка
выпуска пока не объявляется: отсутствует проверка обновления на устройстве,
а общие web-test/lint команды имеют подтверждённые исходные ошибки.

## Изменения по слоям

- **Web:** удалены voice feature, страница настроек, кнопки и пункты меню,
  lazy mounting, запись/отправка аудио, voice native bridge, polling,
  подтверждения, listeners, таймеры, voice context при выходе и аналитика.
  Старый `/voice-assistant/settings` проходит обычный fallback на `/today`.
- **API:** удалены `modules/voice`, создание STT-провайдера и сервиса,
  VoiceSttConfig, VOICE_STT_*, аудиопарсеры и метрики удалённого модуля,
  его OpenAPI routes/components/tag. POST двух старых `/api/voice/*`
  маршрутов возвращает 404 для JSON и аудио; STT не вызывается.
- **Contracts:** удалены voice action/command/metrics/corpus и
  PlannerIntentParser встроенного помощника, package/barrel exports.
  Актуальные настройки пользователя/workspace не содержат voice-полей.
- **Android:** удалены 70 Java-файлов runtime, service/plugin/activity,
  wakeword/STT/VAD/PCM/embeddings, модели, звуки, parity и тесты удалённого
  функционала, ONNX/LiteRT и их Gradle/manifest-конфигурация. Удалены
  RECORD_AUDIO, FOREGROUND_SERVICE и FOREGROUND_SERVICE_MICROPHONE.
  Проверены merged manifest, APK ZIP и определения DEX-классов.
- **Инструменты:** удалены voice quality report, wakeword audit/train,
  tracked training/parity tools; обновлены check, budgets, coverage
  hotspots, ESLint и Renovate. Порогов покрытия/общих бюджетов не снижали.
- **Развёртывание:** Caddy использует `microphone=()`, проверка синхронна;
  удалена передача STT-параметров. Реальные env и внешние secrets не менялись.
  Voice-руководства помечены архивными; README и release docs обновлены.

Полный перечень файлов: [changed-files.txt](changed-files.txt).
Карта зависимостей до удаления: [inventory.md](inventory.md).
Подробности по слоям: [web](web-verification.md),
[Android](android-verification.md), [БД и контракты](database-verification.md),
[браузерные проверки](browser-verification.md).

## Сохранённые общие функции

`openAndroidSystemAppSettings` перенесён в нейтральный web-модуль и
`PlannerAppSettingsPlugin`, зарегистрированный в MainActivity. Он открывает
`ACTION_APPLICATION_DETAILS_SETTINGS` с URI собственного package;
ошибки передаются вызывающей странице. Вне Android функция безопасно
завершается, а страница объясняет платформенное ограничение.

Сохранены native auth storage, общий ключ шифрования/Keystore, refresh,
Firebase/push, POST_NOTIFICATIONS, общие VIBRATE/WAKE_LOCK, виджеты и
JobScheduler, backup files plugin, ручные операции, ai-context, MCP/OAuth,
офлайн-кэш и очередь. iOS/Capacitor не имели удаляемой зависимости и не
получили лишних изменений. ApplicationId/signing identity не изменены.

MicIcon оставлен в общем каталоге, включая сохранённые пользовательские
значения. `source='voice'` сохранён во всех нужных контрактах, БД, покупках,
синхронизации, экспорте и восстановлении. Существующие сущности и роль
`test` не удалялись и не переименовывались.

## Алиса

Сохранены parser, rules/LLM fallback, YandexGPT/OpenAI-compatible providers,
регистрация webhook/OAuth, исключения auth hook, rate limiting, account
linking page и token flow. `ALICE_OAUTH_*`, `ALICE_LLM_*`, `YANDEX_API_KEY`
и `YANDEX_FOLDER_ID` сохраняются в конфигурации и deploy forwarding.

Проверены отсутствие токена/account linking, регистрация/вход на странице
привязки, code exchange, refresh и invalid/revoked tokens; создание задачи
с датой/временем, покупка source=`voice` и обычное редактирование такой
покупки, план на сегодня/завтра и часовой пояс, help/start/end/unknown,
rules и LLM fallback с заглушками провайдера. OpenAPI-контракт явно требует
пути Алисы и запрещает регистрацию старых voice routes.

Реальный SQL-тест обнаружил **исходный дефект** в обеих перегрузках
`auth_exchange_oauth_authorization_code`: unqualified `id` конфликтовал
с OUT-полем функции (PostgreSQL 42702). До и после 000106 ошибка одинаковая,
определения функций побайтово совпадают. Отдельная новая миграция 000107
квалифицирует только alias UPDATE-предиката; сигнатуры, grants, RLS,
account links и токены не меняются. Обе перегрузки, replay rejection,
refresh/revocation и ранее открытая сессия проверены на настоящем Postgres.

Настройки навыка и аккаунт Яндекса не трогали. Эти локальные проверки
не заменяют внешний smoke настоящего навыка на тестовом аккаунте.

## Миграции и совместимость

**000106** удаляет только `app.users.voice_assistant_enabled`,
`app.workspaces.wake_word_training_mode_enabled` и точную трёхаргументную
voice-перегрузку preferences. Двухаргументная функция calendar/energy
сохраняется с authenticated execute и без PUBLIC execute. CASCADE нет.
Исторические миграции не изменялись. Системный каталог проверен на
зависимости, функции, индексы, grants/RLS и OAuth-инфраструктуру.

Проверены полная цепочка на новой БД и обновление предыдущей схемы,
сохранность задач/покупок/настроек/ролей/сессий, runtime role и изоляция
workspace. Только отдельные временные Docker-БД на localhost:55439.
Дополнительно новый код проверен на старой схеме 000105: 94 PostgreSQL
теста и реальные HTTP/settings/backup проверки прошли. См.
[совместимость переходного релиза](transition-verification.md).

**Wire compatibility:** старые поля отсутствуют в domain и SQL, но ответы
session/preferences/workspace содержат deprecated boolean `false`.
Известные старые boolean-поля PATCH проверяются и игнорируются, обычные
настройки сохраняются; voice-only preferences PATCH — no-op. Это исключает
`default(true)` в старом онлайн-клиенте. Условие удаления адаптера и
ограничение для уже работающего офлайн-APK описаны в плане выпуска.

**Backup v1:** явно разрешены только два известных legacy boolean-поля;
после строгой проверки они удаляются до построения restore SQL.
Остальные неизвестные поля и неверные типы по-прежнему отвергаются.
Новый export не содержит удалённых столбцов. Проверены оба legacy `true`,
покупки source=`voice`, новый roundtrip и реальный restore на Postgres.

**Локальное состояние:** web удаляет только
`planner.voiceAssistant.deviceSettings.v1` и
`planner.webVoice.sessionId.v1`. Android до запуска bridge останавливает
старое имя service, удаляет `planner.voice.*` из двух известных preferences
stores, training opt-in, уведомление 1208 и channel `planner-voice-assistant`.
Повторный запуск безопасен, ошибки не блокируют запуск и допускают retry.
Токены, общий ключ, IndexedDB, widget data и очередь не очищаются.
SW runtime cache обновлён v3→v4; устаревшие shell/chunks удаляются отдельно
от пользовательских офлайн-данных.

## Локальные данные и допустимые остатки

Ignored Android-модели перемещены из исходных assets в временный каталог
для сохранения; свежая сборка не включает их. Дополнительно aapt исключает
`wakewords`, `.onnx` и `.tflite`; это проверено временными тестовыми файлами.
Временные проверочные файлы удалены после теста.

Личные записи/датасеты не уничтожались, .gitignore сохранён. Инвентаризация
локальных данных вне продуктовой сборки: datasets/wakeword — 17 510 файлов,
488 221 163 байт; tools/wakeword-training после удаления tracked tools —
60 921 файл, 1 949 276 954 байта; .wakeword-venv — 13 753 файла,
1 245 738 345 байт. В приложении сохранены личные
`wakeword/haotika/{positive,real-world}` samples без reader/uploader/runtime.

Остаточные упоминания классифицированы в [residual-audit.md](residual-audit.md):
Алиса; общие данные/иконки/роли; исторические миграции/аудиты/releases;
архивные инструкции; backup/wire compatibility; upgrade cleanup;
защитные тесты и запрет попадания старых assets. Пропущенного действующего
встроенного runtime в просмотренных исходниках и новых артефактах не найдено.

## Проверки и артефакты

Точные команды, результаты и исходные сбои собраны в
[verification-results.md](verification-results.md).

Чистый debug APK **1.1.19 / versionCode 27** (четыре default ABI): **8 051 935 байт** вместо
**153 332 747 байт** при одинаковых параметрах; разница −145 280 812 байт
(−94,75%). SHA-256:
`795b137c48961ea642a67f7fce43e43bb6fb8ac8809964f9c7bffbc9b90eb740`.
Путь: `android/app/build/outputs/apk/debug/app-debug.apk`.
APK предназначен только для локальной проверки, а не публикации.

Web budget: entry JS 106,8 KB, initial JS 750,3 KB. Все существующие
неголосовые бюджеты прошли. Сопоставимой исходной web-сборки в этой задаче
не измеряли, поэтому уменьшение её размера не заявляется.

## Оставшиеся этапы

1. Проверка на тестовом Android-устройстве: launch, реальное открытие
   системных настроек, upgrade поверх старого APK с сессией/виджетом/
   офлайн-очередью/ожидающей командой. `adb devices -l` пуст.
2. Внешняя проверка навыка Алисы и существующего account link на тестовом
   аккаунте Яндекса после согласованного выпуска.
3. Разобрать исходные сбои общих web-test/lint gates перед release approval;
   подготовить подписанные production-артефакты и два релизных состояния.

Порядок совместимого выпуска, секреты и ограничения отката:
[release-plan.md](release-plan.md).

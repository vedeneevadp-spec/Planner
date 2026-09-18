# Инвентаризация удаления встроенного ввода

2026-09-18: ветка `codex/today-quiet-refresh-1.1.19`, HEAD `2b40273eca2238e5ae7b89b0b514f00825b45676`, git status пуст. AGENTS.md, package.json и структура прочитаны до изменений. Исходные config/build-app/Alice/OAuth: 76/76.

| Элемент                                  | Потребители                            | Действие                                     | Риск                       | Проверка                        |
| ---------------------------------------- | -------------------------------------- | -------------------------------------------- | -------------------------- | ------------------------------- |
| API modules/voice, VoiceSttConfig        | /api/voice/command, /api/voice/metrics | Удалить                                      | Остаточная обработка аудио | API injection, build, аудит     |
| Alice parser/routes, OAuth, ALICE_*      | Яндекс Диалоги, account linking        | Сохранить                                    | Привязка и LLM             | Alice/OAuth tests, OpenAPI      |
| YANDEX_API_KEY, YANDEX_FOLDER_ID         | Alice YandexGPT                        | Сохранить                                    | Потеря fallback            | config tests, deploy check      |
| VOICE_STT_*, YANDEX_IAM_TOKEN forwarding | Только SpeechKit                       | Удалить передачу; реальные secrets не менять | Внешние потребители        | План секретов                   |
| Voice contracts/corpus/intent            | Встроенный ввод                        | Удалить                                      | Общие consumers            | Typecheck, Alice/shopping tests |
| Web feature/page/context/metrics         | App, router, session, admin            | Удалить голосовую часть                      | Auth/offline/settings      | Web regression, браузер         |
| openAndroidSystemAppSettings             | Настройки уведомлений                  | Нейтральный plugin                           | Реальное открытие          | Bridge test, APK, device gap    |
| MicIcon, source=voice, role=test         | Иконки, Алиса/история, роли            | Сохранить                                    | Совместимость данных       | Regression tests                |
| Android runtime/ONNX/LiteRT/models       | Wake word/STT                          | Удалить                                      | Ignored assets/build       | Clean build, manifest/APK       |
| Voice keys/channel                       | Старые web/APK                         | Точечная cleanup                             | Auth/очередь               | Идемпотентность/соседние keys   |
| Voice DB columns/functions               | session, backup                        | Новая миграция + wire false                  | Grants/RLS/старые клиенты  | Isolated fresh/upgrade DB       |
| Legacy backup fields                     | Архивы v1                              | Явно принять и игнорировать                  | Строгость, данные          | Legacy/new/malformed tests      |
| Quality/audit/training scripts           | check, CI, обучение                    | Удалить tools, обновить guards               | Сломанные агрегаты         | Checks/Knip                     |
| Личные training audio/data/venv          | Локальные эксперименты                 | Сохранить вне сборки/Git                     | Невоспроизводимые записи   | Инвентаризация, .gitignore      |
| Voice руководства                        | Старая реализация                      | Пометить архивом                             | Устаревшие инструкции      | README audit                    |
| Исторические migrations/audits/releases  | История/restore                        | Сохранить                                    | Fresh chain/dump upgrade   | DB tests                        |

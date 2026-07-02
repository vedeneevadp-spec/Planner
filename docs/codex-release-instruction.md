# Codex release instruction

Скопируй и пришли этот текст Codex, когда нужно зафиксировать изменения,
задеплоить production и собрать APK:

```text
Зафиксируй и выпусти текущие изменения в Planner.

Сделай полный release workflow:
1. Проверь `git status` и кратко посмотри diff, чтобы понять состав изменений.
2. Классифицируй релиз: backend-only, web/PWA UI, SQL/backend contract,
   auth/session/mobile restore, widget/offline, native permissions/assets или
   store/APK release. По типу изменений выбери дополнительные проверки из
   `docs/release-workflow.md`.
3. Обнови `docs/release-notes.md`: перенеси пользовательские изменения из
   `Unreleased` в версионный раздел или добавь/уточни `Unreleased`, если
   версия еще не фиксируется. Текст должен быть пользовательским, без названий
   команд, commit hash и внутренних деталей.
4. Если релиз включает публичный APK/store build, до commit обнови native
   версии: Android `versionCode`/`versionName` в `android/app/build.gradle` и
   iOS `CURRENT_PROJECT_VERSION`/`MARKETING_VERSION` в
   `ios/App/App.xcodeproj`. Если собираешь APK без version bump, явно отметь в
   отчете, что это технический APK, а не полноценный store release.
5. Запусти проверки:
   - минимум `npm run lint`, `npm run typecheck` и релевантные тесты;
   - для обычного release candidate предпочитай `npm run ci`;
   - если менялись SQL/RLS/backend data access, добавь
     `npm run test:api:postgres`;
   - если менялись auth/session/mobile restore/widget/offline completion,
     добавь `npm run test:mobile-auth` и, когда нужен real-device smoke,
     `npm run mobile:auth-smoke -- --api-url=https://chaotika.ru --android`;
   - если менялись auth, routing или основной planner flow, добавь
     `npm run test:e2e`;
   - если планируется store release, добавь `npm run mobile:doctor`.
6. Закоммить все текущие изменения одним осмысленным commit message.
7. Запушь текущую ветку в upstream.
8. Задеплой production через `npm run deploy:prod`. Учти, что deploy-скрипт
   требует clean pushed branch и сам запускает `npm run ci`, если не указан
   `--skip-checks`.
9. После успешного деплоя собери APK командой:
   `npm run mobile:release:rustore:arm64 -- --api-url=https://chaotika.ru`
10. Найди APK по пути:
   `android/app/build/outputs/apk/release/app-release.apk`
11. Отправь результаты в Telegram через бота, явно разделяя два варианта:
   - Личный чат для меня (`TELEGRAM_CHAT_ID`): оставь как есть. Отправь APK и техническую сводку: что изменилось, commit hash, результат проверок, deploy status и путь/имя APK.
   - Группа (`TELEGRAM_GROUP_CHAT_ID`): отправляй только если я явно прошу отправить в группу. В группу отправь отдельный текст "Обзор обновления" для пользователей: что стало лучше и что изменилось в интерфейсе/поведении. Не добавляй отдельный блок "Что можно попробовать". Отдельно отправь APK в группу с короткой пользовательской подписью без технических деталей. Не добавляй commit hash, названия команд, пути к файлам, статус деплоя, APK-путь и другие технические нюансы.
12. Если прошу отправить и мне, и в группу, отправь в личный чат полный технический вариант с APK, а в группу - пользовательский обзор без технических деталей и APK с короткой пользовательской подписью.
13. Если для Telegram не хватает токена/chat id или переменных окружения, не светить секреты в ответе, а остановиться и сказать, каких данных не хватает.

В конце дай короткий отчет: что закоммичено, куда запушено, какие проверки
прошли, как прошел деплой, где APK, был ли version bump/store release и
отправлено ли все в Telegram.
```

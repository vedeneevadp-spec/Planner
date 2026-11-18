# Codex release instruction

Скопируй и пришли этот текст Codex, когда нужно зафиксировать изменения,
задеплоить production и собрать APK. В Claude Code тот же процесс запускается
командой `/release` (см. `.claude/skills/release/SKILL.md`); меняя порядок
релиза, обновляй оба документа.

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
4. Повысь версию одной командой (обычно patch +1 и build +1):
   `npm run version:set -- --version=X.Y.Z --build=N`. Она обновляет
   `package.json` (единственный источник версии), `package-lock.json`,
   Android и iOS. Номера в `build.gradle` и `project.pbxproj` вручную не
   правь. Раздел release notes из шага 3 должен называться `## vX.Y.Z`;
   `npm run version:check` сверяет всё это (и CI тоже).
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
7. Запушь текущую ветку, открой PR в `main`, дождись зелёного CI и влей PR
   (squash-merge). Затем переключись на `main` и обнови его:
   `git switch main && git pull --ff-only`.
8. Задеплой production через `npm run deploy:prod` из `main`. Deploy-скрипт
   требует чистую запушенную ветку, отказывается выкатывать commit, которого
   нет в `origin/main`, и проверяет GitHub CI этого commit: зелёный CI
   заменяет локальный `npm run ci`, упавший останавливает deploy. После
   успешного деплоя он ставит и пушит тег `deploy/YYYYMMDD-HHMMSS`; укажи
   этот тег в отчёте.
9. После успешного деплоя собери APK командой:
   `npm run mobile:release:rustore:arm64 -- --api-url=https://chaotika.ru`
10. Найди APK по пути:
   `android/app/build/outputs/apk/release/app-release.apk`
11. Отправь результаты в Telegram скриптом `npm run notify:telegram`
   (`--to=personal|group`, `--text-file=...`, `--file=<APK>`,
   `--caption=...`; `--dry-run` для проверки без отправки). Токен и chat id
   скрипт берёт из `.env.telegram.local` сам — не читай и не выводи их.
   Явно разделяй два варианта:
   - Личный чат для меня (`TELEGRAM_CHAT_ID`): оставь как есть. Отправь APK и техническую сводку: что изменилось, commit hash, результат проверок, deploy status и путь/имя APK.
   - Группа (`TELEGRAM_GROUP_CHAT_ID`): отправляй только если я явно прошу отправить в группу. В группу отправь отдельный текст "Обзор обновления" для пользователей: что стало лучше и что изменилось в интерфейсе/поведении. Не добавляй отдельный блок "Что можно попробовать". Отдельно отправь APK в группу с короткой пользовательской подписью без технических деталей. Не добавляй commit hash, названия команд, пути к файлам, статус деплоя, APK-путь и другие технические нюансы.
12. Если прошу отправить и мне, и в группу, отправь в личный чат полный технический вариант с APK, а в группу - пользовательский обзор без технических деталей и APK с короткой пользовательской подписью.
13. Если для Telegram не хватает токена/chat id или переменных окружения, не светить секреты в ответе, а остановиться и сказать, каких данных не хватает.

В конце дай короткий отчет: что закоммичено, куда запушено, какие проверки
прошли, как прошел деплой, где APK, был ли version bump/store release и
отправлено ли все в Telegram.
```

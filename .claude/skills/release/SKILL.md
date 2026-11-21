---
name: release
description: Выпустить текущие изменения Chaotika — release notes, проверки, PR и merge в main, деплой production, сборка APK и отчёт в Telegram. Запускается только вручную через /release.
argument-hint: '[web | apk | store] [group] [X.Y.Z]'
disable-model-invocation: true
---

# Релиз Chaotika

Аргументы: `$ARGUMENTS`

- `web` — только production (web, PWA, API), без APK.
- `apk` (по умолчанию) — production и signed arm64 APK для RuStore и обновления
  внутри приложения.
- `store` — как `apk`, плюс AAB в закрытый тест Google Play (Alpha); версию и
  номер сборки спросить у пользователя.
- `X.Y.Z` — версия релиза; без неё — следующая patch-версия.
- `group` — дополнительно отправить пользовательский обзор и APK в группу
  Telegram. Без этого слова в группу ничего не отправлять.

Подробности каждого шага — в [docs/release-workflow.md](../../../docs/release-workflow.md).
Всё общение и тексты — по-русски.

## Точки подтверждения

Остановись и спроси пользователя перед каждым из этих действий, даже если
остальное идёт автоматически:

1. merge PR в `main`;
2. `npm run deploy:prod`;
3. публикация обновления внутри приложения (не для `web`), показав версию
   и текст заметок;
4. загрузка в Google Play (только `store`), показав версию и текст «Что
   нового»;
5. отправка в группу Telegram (только при аргументе `group`), показав
   готовый текст.

Эти подтверждения можно собрать одним вопросом, когда все артефакты собраны
и проверены без публикации.

Отправку себе в личный чат отдельно не подтверждать: она часть `/release`.

## Шаги

1. **Состав.** `git status`, `git log origin/main..HEAD`, краткий просмотр
   diff. Если есть незакоммиченные изменения, не относящиеся к релизу, спроси,
   что с ними делать.
2. **Тип релиза.** backend-only, web/PWA UI, SQL/backend contract,
   auth/session/mobile restore, widget/offline, native permissions/assets,
   store/APK. От типа зависят проверки в шаге 5.
3. **Версия.** Единственный источник — `version` в корневом `package.json`;
   текущую показывает `npm run version:check`. Каждый релиз получает новую
   версию: по умолчанию patch +1 и build +1 (например, 1.1.43 / 51 →
   1.1.44 / 52). Если в аргументах указана версия `X.Y.Z`, возьми её; для
   `store` спроси версию и номер сборки. Примени одной командой — она обновит
   `package.json`, `package-lock.json`, Android и iOS:
   `npm run version:set -- --version=X.Y.Z --build=N`. Вручную номера в
   `build.gradle` и `project.pbxproj` не править.
4. **Release notes.** В [docs/release-notes.md](../../../docs/release-notes.md)
   перенеси пункты из `Unreleased` в раздел `## vX.Y.Z - YYYY-MM-DD` с этой же
   версией и каналами (`Web`, `PWA`, `API`, `Android` …). Пиши о
   пользовательском эффекте, без команд, хэшей и внутренних деталей. Если
   релиз не только `web`, добавь в раздел подраздел `### Google Play` —
   короткий текст «Что нового» до 500 символов: он идёт и в Google Play, и в
   заметки обновления внутри приложения. Затем `npm run version:check` должен пройти: он
   сверяет версию в `package.json`, нативных проектах и в последнем разделе
   release notes (то же проверяет CI).
5. **Проверки.** Всегда `npm run lint`, `npm run typecheck`,
   `npm run test:web:run`, `npm run test:api`. Дополнительно:
   - SQL/RLS/postgres-репозитории — `npm run test:api:postgres`;
   - auth/session/mobile restore/widget/offline — `npm run test:mobile-auth`;
   - auth, роутинг, основной сценарий — `npm run test:e2e`;
   - store — `npm run mobile:doctor`.

   Полный `npm run ci` локально не нужен: его выполнит GitHub CI в PR.
6. **Коммит и PR.** Если ты в `main`, создай ветку `release/<версия-или-тема>`.
   Закоммить (`type(scope): описание по-русски`), запушь, открой PR в `main`
   через `gh pr create`. Дождись CI: `gh pr checks --watch --fail-fast`. Если CI
   упал — разберись и исправь, не обходи.
7. **Merge.** После подтверждения: `gh pr merge --squash --delete-branch`,
   затем `git switch main && git pull --ff-only`.
8. **Deploy.** После подтверждения: `npm run deploy:prod`. Скрипт сам
   проверит, что commit в `origin/main`, возьмёт результат GitHub CI для него
   (дождётся, если CI ещё идёт), выкатит, проверит здоровье и поставит тег
   `deploy/YYYYMMDD-HHMMSS`. Запиши тег из вывода. При ошибке — остановись и
   покажи вывод; флаги `--skip-checks` и `--allow-non-main` без явной просьбы не
   использовать. Если деплой отказался из-за CI, посмотри упавший job
   (`gh run view <id> --json jobs`): job, отменённый из-за нехватки раннеров
   GitHub (например, macOS для iOS), перезапусти `gh run rerun <id> --failed`
   и запусти деплой снова — он дождётся CI. Настоящее падение тестов —
   исправлять, а не перезапускать.
9. **APK (не для `web`).**
   `npm run mobile:release:rustore:arm64 -- --api-url=https://chaotika.ru`.
   Результат: `android/app/build/outputs/apk/release/app-release.apk`. Если
   подпись не настроена (`android/keystore.properties`), остановись и скажи
   об этом; содержимое keystore не читать. Скопируй APK во временный каталог
   как `Chaotika-X.Y.Z-buildN-arm64-v8a.apk`: следующие сборки используют тот же
   каталог `android/app/build`, а копию дальше отправляют в Telegram.

   **Обновление внутри приложения (не для `web`).** Пользователи APK получают
   «Обновить» только после публикации. Сохрани текст `### Google Play` в файл
   заметок (UTF-8):

   ```bash
   node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; import {extractGooglePlayNotes} from './scripts/google-play-publish.mjs'; writeFileSync('<заметки>', extractGooglePlayNotes(readFileSync('docs/release-notes.md','utf8'),'X.Y.Z')+'\n')"
   ```

   Проверь без публикации:
   `npm run mobile:update:prepare -- --notes-file=<заметки> --apk=<копия APK>`.
   После подтверждения — `npm run mobile:update:publish` с теми же
   аргументами, затем убедись, что
   `https://chaotika.ru/android-updates/latest.json` отдаёт новую версию.
   Откатить версию этим механизмом нельзя.

   **Google Play (только `store`).** Собери AAB:
   `npm run mobile:release:google-play -- --api-url=https://chaotika.ru`, затем
   `npm run mobile:publish:google-play:dry-run` (доступ, версия, текст «Что
   нового»). После подтверждения — `npm run mobile:publish:google-play`: AAB
   уходит в Alpha со статусом `completed` и сразу на проверку Google. Ключ
   сервисного аккаунта скрипт находит сам; не читай и не выводи его. Если
   публикация упала (например, `fetch failed` — смотри строку `cause`), перед
   повтором запусти dry-run: строка «alpha currently has versionCode up to N»
   покажет, попала ли сборка в трек, чтобы не опубликовать её дважды.
10. **Telegram, личный чат.** Подготовь техническую сводку в файл во
    временном каталоге: что изменилось, тег деплоя и commit, результаты
    проверок, статус деплоя, версия и build, имя и размер APK. Затем:

    ```bash
    npm run notify:telegram -- --to=personal --text-file=<сводка> --file=android/app/build/outputs/apk/release/app-release.apk --caption="Chaotika <версия>"
    ```

    Для `web` — без `--file` и `--caption`. Сначала можно прогнать с
    `--dry-run`.

11. **Telegram, группа (только `group`).** Отдельный текст «Обзор обновления»
    для пользователей: что стало лучше и что изменилось в интерфейсе. Без
    блока «Что можно попробовать», без хэшей, команд, путей, статуса деплоя.
    Покажи текст, получи подтверждение, затем:

    ```bash
    npm run notify:telegram -- --to=group --text-file=<обзор> --file=android/app/build/outputs/apk/release/app-release.apk --caption="<короткая подпись для пользователей>"
    ```

12. Если скрипт сообщает, что не хватает `TELEGRAM_*`, остановись и назови
    недостающие переменные. Значения секретов не выводить и не читать
    `.env*.local` напрямую.

## Отчёт

Коротко: что вошло в релиз, PR и merge-commit, тег деплоя, какие проверки
прошли, версия и build, путь к APK, был ли store release, что и куда
отправлено в Telegram.

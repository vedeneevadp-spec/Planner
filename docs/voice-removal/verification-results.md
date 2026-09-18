# Проверки удаления встроенного ввода

Все DB/e2e проверки используют отдельный временный Docker Postgres
`planner-voice-removal-db-20260918`, localhost:55439, БД `voice_*`.
Личные/production данные, аккаунт Яндекса и реальные устройства не менялись.
После всех проверок контейнер с его временным volume и тестовыми БД удалён,
созданные для визуальной проверки серверы 3119/5190 остановлены.

## Выполненные команды

| Проверка                                                                                                                         | Результат                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Исходные API config/build-app/Alice/OAuth                                                                                        | 76/76 PASS до изменений                                                              |
| Исходные web focused                                                                                                             | 7 suites, 50/50 PASS                                                                 |
| Исходные DB session/backups/helper unit                                                                                          | 22/22 PASS                                                                           |
| Исходные Android unit + debug assemble                                                                                           | 104/104 PASS; исходный APK измерен                                                   |
| `npm run test:api` после всех API изменений                                                                                      | **369/369 PASS**, 0 skipped                                                          |
| Alice/OAuth/config focused после расширения регрессий                                                                            | **37/37 PASS**                                                                       |
| Session/backup/compatibility focused                                                                                             | **39/39 PASS**                                                                       |
| `npm run test:api:postgres` с migration opt-in                                                                                   | **96/96 PASS**, 0 skipped                                                            |
| Новый API на старой схеме 000105 (переходный релиз A)                                                                            | **94 PASS**, 2 opt-in migration skips; отдельные HTTP/prefs/backup PASS              |
| Fresh/upgrade migration tests (входят в 96)                                                                                      | 2/2 PASS; OAuth/RLS/data/old+new backups                                             |
| `DB_SECURITY_REQUIRE_NON_OWNER=1 node scripts/db-security-check.mjs`                                                             | PASS на отдельной runtime login role                                                 |
| `npm run db:migrations:check`                                                                                                    | PASS                                                                                 |
| `npm run test:web:run`                                                                                                           | **1206 PASS, 16 исходных TodayPage failures**                                        |
| Финальный web focused                                                                                                            | 18 suites, **168/168 PASS**                                                          |
| `npm run test:e2e`                                                                                                               | **19/19 PASS**, включая desktop/mobile auth, accessibility, offline, tasks, cleaning |
| `npm run typecheck`                                                                                                              | PASS: web + contracts + API                                                          |
| `npm run lint`                                                                                                                   | Исходный сбой в ignored local tmp script, см. ниже                                   |
| `npx eslint . --ignore-pattern 'tmp/**'`                                                                                         | PASS; все рабочие исходники проверены без чужого временного script                   |
| `npm run time:guard`                                                                                                             | PASS                                                                                 |
| `npm run format:check`                                                                                                           | PASS                                                                                 |
| `npm run deadcode:strict`                                                                                                        | PASS                                                                                 |
| `npm run openapi:check`                                                                                                          | PASS, включая Alice и отсутствие voice registrations                                 |
| `npm run prod-config:check`                                                                                                      | PASS                                                                                 |
| `node --test scripts/deploy-prod.test.mjs scripts/infrastructure-backup.test.mjs scripts/mobile-release-android-config.test.mjs` | **30/30 PASS**; покрывает test:deploy/test:backup/test:mobile-release                |
| `npm run mobile:ci-check`                                                                                                        | PASS                                                                                 |
| `MOBILE_ENV_FILE='' VITE_API_BASE_URL=http://127.0.0.1:3001 VITE_AUTH_PROVIDER=planner npm run mobile:sync:android`              | PASS; включает `npm run build` и Capacitor sync                                      |
| `npm run build:api` после финальных OpenAPI изменений                                                                            | PASS                                                                                 |
| `npm run build:budget`                                                                                                           | PASS; бюджеты не повышались, runtime signature guard PASS                            |
| `JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'` + Gradle clean/testDebugUnitTest/assembleDebug         | **22/22 PASS**, чистый APK                                                           |
| `npm run mobile:android:budget`                                                                                                  | PASS                                                                                 |
| APK ZIP/DEX/merged manifest + source ignored-assets audit                                                                        | PASS; временные forbidden assets не попали в APK                                     |
| `git diff --check`                                                                                                               | PASS                                                                                 |

Агрегат mobile:android:ci повторно не запускался: его sync, tests, assemble
и budget выполнены по отдельности. Полный `check`/`ci` не объявляется
успешным из-за исходных web/lint ошибок; coverage/audit/actionlint и
подписанный release build дополнительно не запускались.

## Исходные ошибки и ограничения среды

1. **TodayPage — 16 failures.** Проверки ищут раскрытый текст нагрузки
   (`Оценено N из N` и похожие подписи), когда панель по умолчанию свёрнута
   (`aria-expanded=false`). Точный тестовый файл из исходного HEAD отдельно
   воспроизвёл те же **16 failures / 67 passed**. Временная копия удалена.
   Runtime TodayPage не менялся, его fixtures получили лишь удаление
   двух устаревших полей. Логи: `/tmp/planner-web-tests.log` и
   `/tmp/planner-today-head-baseline.log`.
2. **Global lint:** `tmp/release-1.1.19-20260917/telegram-release.mjs:98`
   содержит неиспользуемую `fileId`. Это существующий ignored local файл,
   отсутствующий в Git. Он не изменён; исключение использовано только в
   дополнительной команде проверки, конфигурацию ESLint для обхода ошибки
   не ослабляли.
3. **SQL OAuth 42702:** исходная неоднозначность `id` воспроизведена до и
   после 000106. Исправлена отдельной 000107, обе перегрузки и токены
   подтверждены реальными SQL-тестами. Подробности и hashes в DB отчёте.
4. **Android instrumentation baseline:** старый ExampleInstrumentedTest
   ожидает `com.getcapacitor.app`, тогда как приложение — `ru.chaotika.app`.
   Этот посторонний шаблонный тест не меняли; instrumentation на устройстве
   не запускался, поскольку `adb devices -l` пуст.
5. Системный `/usr/bin/python3` недоступен из-за Xcode loader; использован
   имеющийся Python из локального uv runtime. Homebrew Postgres14 не
   запускается из-за отсутствующей ICU71; использован отдельный Docker
   Postgres18. Конфигурация хоста не менялась.

## Визуальная проверка

Dev server + отдельная тестовая БД; вручную через браузер осмотрены «Ещё»,
настройки уведомлений и «Сегодня» с тестовым Alex. Голосовых пунктов и
пустых секций нет; уведомления имеют корректное web-пояснение.
Встроенный браузер периодически возвращал CDP timeout при вводе и
навигации; подтверждение состояния выполнялось повторным DOM/screenshot,
а не трактовкой timeout как успеха.

Дополнительные focused e2e **2/2 PASS** (1365×900 и 390×844):
«Ещё», уведомления, admin settings, старый URL→Today, Today/calendar/shopping.
Проверены клавиатурный фокус ссылки, отсутствие горизонтального overflow,
console/page errors, microphone calls и voice network requests, точечная
очистка legacy storage с сохранением соседнего значения и авторизации.
Снимки после полной загрузки страниц осмотрены отдельно.

Финальный запуск обоих сценариев: **2/2 PASS за 23 секунды**; лог
`/tmp/planner-retired-input-e2e-final.log`. Подробности:
[browser-verification.md](browser-verification.md). 14 PNG:
`/tmp/planner-voice-removal-screenshots/`.
Суммарно прошли 19 существующих + 2 новых e2e сценария.

Реальное открытие Android settings, background/foreground/upgrade с
установленным старым APK и настоящий навык Яндекса остаются внешними
контрольными точками выпуска.

## Воспроизведение DB migration regression

На отдельном локальном Postgres с правом создания **только тестовых БД**:

```sh
DATABASE_URL=postgres://planner:planner@127.0.0.1:55439/voice_fresh \
VOICE_REMOVAL_MIGRATION_TEST_DATABASE_URL=postgres://planner:planner@127.0.0.1:55439/voice_fresh \
npm run test:api:postgres
```

Opt-in migration tests проверяют localhost и имя `voice_*`, создают свои
изолированные базы, применяют chain и удаляют только созданные ими БД.
В обычном окружении без opt-in они пропускаются; результат 96/96 выше
получен с включённой проверкой, без пропусков.

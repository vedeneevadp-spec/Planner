# Аудит качества и безопасности Planner

Дата: 15 ноября 2026 года, Asia/Novosibirsk.

Проект имеет развитые автоматические проверки, но они пропускают ошибки на границах авторизации, офлайн-синхронизации и файлового хранилища. Найдены четыре проблемы уровня P1, одна из которых относится только к iOS, десять P2 и два дополнительных риска устойчивости. Первоочередная работа — закрыть доступ по неподтверждённому email, проверку отзыва сессий Алисы и отправку очищенных очередей. После этого нужен направленный рефакторинг общих контрактов; переписывание приложения целиком не обосновано.

Проверенный локальный commit: `6a6a9d7638846f76f0122e82b9ceab25144e5c19`, Android 1.1.42 (50). Рабочее дерево до аудита было чистым. Исходники приложения не изменялись, исправления и публикация не выполнялись.

Удалённый `main` уже содержит `a832be3f240e38a9763f8e74453d67726bd525b3`: один дополнительный commit с изменениями только `package.json` и `package-lock.json`, обновляющий overrides glob 14.0.4 → 14.0.5 и minimatch 11.0.5 → 11.0.8. Описанные ниже участки приложения и CI совпадают. Локальные проверки зависимостей относятся к локальному lockfile.

## Область и доказательства

Проверены API, права workspace, auth/OAuth/MCP/Alice, SQL и RLS, web и offline-хранилища, контракты Android/iOS, CI, деплой, backup, зависимости и доступность интерфейса. Инвентаризация `apps`, `packages`, `tests` охватывает 825 TS/TSX-файлов и 243 244 строки, включая 252 тестовых файла. Это инвентаризация всего контура и углублённый анализ критических областей, а не утверждение о ручном прочтении каждой строки.

Использованы локальные тесты, Fastify inject, реальные PostgreSQL-маршруты в одноразовом контейнере, fake-indexeddb и управляемые сетевые ответы. Browser E2E работали на отдельной БД, не на пользовательской. Доступ к рабочим аккаунтам, реальные рассылки, LLM-запросы и изменения production не выполнялись.

Уровни: **P1** — исправить в первую очередь из-за нарушения доступа, целостности или основной функции; **P2** — существенная ошибка или риск с дополнительными условиями; **P3** — сопровождение. Метки доказательств: **исполнение** — воспроизведено; **код** — подтверждён путь в исходниках; **условный риск** — последствие зависит от эксплуатационных условий.

## Проблемы первого приоритета

### A01 Приглашение в общее пространство можно принять без владения email

**P1 · безопасность · исполнение на PostgreSQL.** Регистрация сразу создаёт сессию без подтверждения почты. Получение и принятие приглашения доверяют совпадению email аккаунта с адресатом. Человек, зарегистрировавший ещё свободный чужой email, получает возможность принять приглашение на этот адрес без доступа к почтовому ящику.

Источники: [auth.service.ts:136](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/modules/auth/auth.service.ts:136>), [session.repository.postgres.ts:586](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/modules/session/session.repository.postgres.ts:586>), [accept:604](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/modules/session/session.repository.postgres.ts:604>).

В изолированном API подтверждено: регистрация без проверки почты → приглашение обнаруживается → принятие возвращает 204 → общее пространство доступно с ролью member. Существующий аккаунт с занятым email этим способом не захватывается; проблема касается непроверенной идентичности новых аккаунтов и адресованных им приглашений.

Исправление: хранить подтверждение email и требовать его до раскрытия/принятия приглашений либо использовать одноразовый секрет приглашения, доставляемый владельцу почты. Ограничение должно действовать в сервисе и SQL/RLS-функциях. При привязке Google сохранять существующую защиту от автоматического объединения аккаунтов только по совпадению адреса. Регрессия должна проверять неподтверждённый аккаунт, подтверждённый аккаунт и повторное принятие.

### A02 Алиса принимает токен отозванной сессии

**P1 · безопасность · исполнение.** Webhook самостоятельно проверяет подпись и срок JWT, обходя `isSessionActive`, используемый обычным API. Токен с отозванной сессией продолжает разрешать операции через Алису до истечения JWT.

Источники: [alice.routes.ts:369](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/modules/alice/alice.routes.ts:369>), [jwt-request-authenticator.ts:53](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/infrastructure/auth/jwt-request-authenticator.ts:53>).

Один и тот же синтетический JWT при validator=false получил 401 `invalid_access_token` на обычном session API и успешное создание задачи через Alice webhook. Это проверка локального приложения, не свидетельство эксплуатации на production.

Исправление: единая проверка access token и активности сессии для всех transport-адаптеров. Добавить отрицательные проверки Alice после logout, reset password и явного отзыва сессии.

### A03 Очистка очереди покупок не прекращает отправку старых команд

**P1 · целостность данных · исполнение.** Общий обработчик сохраняет список команд в памяти. После purge записи IndexedDB исчезают, но обработчик продолжает вызывать API для следующей команды: отсутствие записи в `markSyncing` не останавливает `apply`.

Источники: [offline-sync.ts:127](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/shared/lib/offline-sync/offline-sync.ts:127>), [offline-shopping-list-sync.ts:66](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/features/shopping-list/lib/offline-shopping-list-sync.ts:66>), [user-backup-local-state.ts:24](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/features/user-backup/lib/user-backup-local-state.ts:24>).

Воспроизведение: первая из двух команд DELETE задержана; очередь очищена и имеет длину 0; после завершения первой команды клиент всё равно отправляет вторую и сообщает `synced: 2`. Это создаёт возможность применить старые удаления/изменения после восстановления backup. Аналогичный механизм есть в legacy habits. Запись после успешного серверного отзыва токена не утверждается.

Исправление: общий generation token, проверка актуальности непосредственно перед отправкой, остановка обработки при purge. Восстановление должно дождаться завершения/безопасного прерывания записей до изменения данных. Отдельно определить результат уже отправленной команды: abort клиентского ожидания сам по себе не откатывает серверный commit.

### A04 Обновление сессии iOS вызывает отсутствующие native методы

**P1 для iOS · работоспособность · код.** Swift `PlannerAuthStoragePlugin` экспортирует только get/set/remove. Общий native auth для обеих платформ вызывает prepareRefresh/commitRefresh. Android реализует эти методы; iOS — нет. Сохранить первоначальный вход можно, а обновить истёкший токен через этот путь нельзя.

Источники: [AppDelegate.swift:9](</Users/daryavedeneeva/ Projects  /Planner/ios/App/App/AppDelegate.swift:9>), [native-session-storage.ts:75](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/features/session/lib/native-session-storage.ts:75>), [auth-session-storage.ts:148](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/features/session/lib/auth-session-storage.ts:148>).

Исправление: атомарные операции prepare/commit в Keychain с теми же гарантиями, что на Android; контрактная проверка набора методов и реальный iOS refresh-сценарий. Сборка Swift и JS-мок плагина такую несовместимость не выявляют. На физическом iPhone ошибка не проверялась; Android к этой находке не относится.

## Другие подтверждённые проблемы

### A05 Обмен refresh token MCP неатомарен

**P2 · безопасность · исполнение с repository double и подтверждение кода.** [mcp-haotika.auth.ts:324](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/modules/mcp-haotika/mcp-haotika.auth.ts:324>) последовательно читает токен, отзывает его и создаёт новый. Два параллельных обращения могут прочитать одно действующее состояние и оба получить новые токены. Переданный clientId также не сверяется с владельцем исходного токена.

Воспроизведение даёт два успешных refresh с разными новыми токенами и успешный запрос с другим clientId. Использован repository double с независимыми снимками записей, соответствующими поведению SQL-маппинга; конкурентный SQL-тест именно MCP не выполнялся. Для использования этого недостатка требуется владение действующим refresh token.

Исправление: атомарное consume-and-rotate в одной транзакции с проверкой результата отзыва и привязки клиента; определить обработку повторов и token family. Тестировать конкурентный обмен и восстановление после потерянного ответа, чтобы исправление не сломало нормальный клиент.

### A06 Анонимный запрос Алисы может вызвать платный LLM

**P2 при включённом LLM · расходы и доступность · исполнение.** [alice.routes.ts:169](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/modules/alice/alice.routes.ts:169>) запускает parser до проверки авторизации на строке 192. Webhook регистрируется отдельно и не получает существующий auth/MCP rate limiter.

С fetch-stub анонимная неизвестная команда вызвала LLM один раз, и лишь затем приложение предложило привязку аккаунта. Реальный провайдер не вызывался; включённость LLM на production не проверялась.

Исправление: дешёвые команды помощи обрабатывать локально, платный разбор выполнять после проверки пользователя; добавить отдельные квоты, rate limit и ограничение параллелизма webhook.

### A07 Активные покупки пропадают после накопления 200 записей

**P2 · функциональность · исполнение реального клиента и memory repository.** [shopping-list-api.ts:116](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/features/shopping-list/lib/shopping-list-api.ts:116>) получает только первую страницу из 200 записей, включая архив, и теряет total/page. [useShoppingList.ts:254](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/features/shopping-list/lib/useShoppingList.ts:254>) заменяет локальный снимок этой выборкой.

На 201 записи — одной старой активной и 200 новых архивных — клиент вернул 200 архивных и ни одной активной. Активная запись сохранилась на второй странице сервера. Это скрытие из интерфейса и кэша, а не удаление из БД.

Исправление: полный набор активных покупок, отдельная пагинация архива, явная полнота снимка. Регрессия — старая активная запись за границей первой страницы.

### A08 Legacy очередь привычек теряет новую правку при подтверждении старой

**P2 · скрытый дефект старого кода · исполнение.** [offline-habit-store.ts:533](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/features/habits/lib/offline-habit-store.ts:533>) объединяет новую правку с записью в статусе syncing. Подтверждение старого запроса удаляет её по ID вместе с новой правкой.

Воспроизведение: отправляется `done / first change`; во время ожидания добавляется `skipped / SECOND CHANGE`; подтверждение первой операции опустошает очередь, хотя вторая не отправлена.

Текущий интерфейс этот сценарий не предоставляет: `/habits` перенаправляет в self-care, `HabitsTodayPanel` не монтируется, флаг создания привычек в TaskComposer выключен всеми внешними вызовами. Поэтому это не P1 текущего UI. Следует завершить удаление старой реализации либо восстановить её контракт: не менять in-flight команду и подтверждать конкретную ревизию.

### A09 Ошибка удаления старого аватара удаляет уже сохранённый новый

**P2 · целостность файлов · исполнение.** В [session.service.ts:362](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/modules/session/session.service.ts:362>) один try/catch охватывает commit профиля и удаление старого файла. Если последующее удаление старого файла падает, catch удаляет новый файл, хотя БД уже указывает на него.

Service repro с ошибкой storage дал `persistedAvatar=new.png`, `newAvatarExists=false`. Исправление: разделить компенсацию до commit и очистку после commit; удаление старого файла выполнять как повторяемую очистку, не удаляя актуальный ресурс.

### A10 Backup БД и файлов может быть несогласованным

**P2 · восстановление · код.** [infrastructure-backup-create.mjs:44](</Users/daryavedeneeva/ Projects  /Planner/scripts/infrastructure-backup-create.mjs:44>) сначала делает pg_dump, потом копирует assets. Между этими действиями API может заменить аватар/иконку и удалить старый файл. Dump сохранит старую ссылку, но файловая копия её уже не содержит.

Проверка backup проверяет manifest/checksums и возможность прочесть архив; сверка ссылок БД на файлы выполняется только в restore drill. Поэтому такой набор может получить успешный статус. Реальное совпадение этой гонки на production не проверялось.

Исправление: согласованная стратегия snapshot либо отложенная уборка старых файлов с интервалом, перекрывающим backup; до успешного статуса проверять ссылки восстановленного снимка. Одной перестановки копирования файлов и pg_dump недостаточно для гарантии согласованности.

### A11 Политика offsite retention сохраняет каждую отдельную копию

**P2 · эксплуатация · код и документация.** [infrastructure-backup-create.mjs:119](</Users/daryavedeneeva/ Projects  /Planner/scripts/infrastructure-backup-create.mjs:119>) передаёт restic новый timestamp-каталог для каждого backup. [infrastructure-backup-prune.mjs:39](</Users/daryavedeneeva/ Projects  /Planner/scripts/infrastructure-backup-prune.mjs:39>) применяет retention без изменения группировки.

По умолчанию restic группирует по host и paths, применяя политику отдельно к каждой группе. Здесь каждый уникальный путь образует группу из одной копии, которая сохраняется. Это вывод из конфигурации и [официальной семантики restic](https://restic.readthedocs.io/en/stable/060_forget.html#removing-snapshots-according-to-a-policy), а не измерение текущего offsite-хранилища.

Исправление: стабильная группа, например host, и узкий постоянный tag-фильтр приложения/вида backup. Уникальный backup-id не должен входить в группировку. Перед применением проверить план удаления через dry-run; реальный prune в рамках аудита не запускался.

### A12 Пароли БД попадают в аргументы процессов резервного копирования

**P2 · условный локальный security risk · код.** [db-backup.mjs:23](</Users/daryavedeneeva/ Projects  /Planner/scripts/db-backup.mjs:23>) и [infrastructure-backup-create.mjs:44](</Users/daryavedeneeva/ Projects  /Planner/scripts/infrastructure-backup-create.mjs:44>) передают полный connection URL в argv pg_dump. Аналогичный путь есть в restore drill; deploy-backup использует migration credentials. Маскирование ошибки не удаляет секрет из argv.

Если ОС разрешает другим локальным процессам читать командные строки, они могут увидеть пароль. Настройки process visibility на production не проверены; удалённая эксплуатация сама по себе не следует из этого дефекта.

Исправление: URL без пароля и временный PGPASSFILE с правами 0600, очистка в finally. [Документация PostgreSQL](https://www.postgresql.org/docs/current/libpq-pgpass.html) описывает password file и необходимые права.

### A13 Локальная PostgreSQL опубликована на всех интерфейсах

**P2 · dev security · код и Docker runtime.** [docker-compose.yml:15](</Users/daryavedeneeva/ Projects  /Planner/docker-compose.yml:15>) публикует `54329:5432` с известными development credentials `planner/planner`. Docker подтвердил `0.0.0.0:54329` у рабочего dev-контейнера.

При разрешающем firewall подключиться могут другие узлы сети. Доступ из другой сети и production PostgreSQL не проверялись. Исправление: привязать development-порт к `127.0.0.1`; удалённый доступ включать отдельной явной конфигурацией. В аудите параметры рабочего контейнера не менялись; собственная тестовая БД слушала только localhost.

### A14 Фокус клавиатуры выходит из модального окна

**P2 · доступность · браузерное исполнение.** [TaskEditDialog.tsx:259](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/entities/task/ui/TaskEditDialog.tsx:259>) объявляет `aria-modal=true`, но использует div без focus trap/inert. Effect обрабатывает только scroll и Escape.

В Chromium после 19 нажатий Tab фокус вышел из диалога на body при всё ещё открытом окне. Автоматический axe-сценарий при этом проходит. Сходные реализации есть в WorkspaceParticipantsDialog и self-care, но для них отдельный клавиатурный прогон не выполнялся.

Исправление: переиспользовать существующий [PlannerDialog](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/shared/ui/PlannerDialog/PlannerDialog.tsx:12>) с showModal, initial focus и возвратом фокуса; отдельно проверить вложенные окна и busy-состояние. Десктопная и мобильная компоновка редактора просмотрены; переполнения на проверенных размерах не обнаружено.

## Дополнительные риски устойчивости

1. **Общий API requester не задаёт deadline.** [api-client.ts:91](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/shared/lib/api-client/api-client.ts:91>) передаёт signal только от вызывающего кода. С зависшим mock fetch mutation оставалась pending через 16 секунд без AbortSignal, хотя auth использует 15-секундный timeout. В настоящей сети срок зависит от транспорта. Зависшая запись может задержать последовательную очередь. Нужны ограничение всей операции, включая body, и согласованная стратегия повторов/idempotency.
2. **Обновление PWA принудительно перезагружает открытые формы.** [register-service-worker.ts:65](</Users/daryavedeneeva/ Projects  /Planner/apps/web/src/shared/lib/pwa/register-service-worker.ts:65>) вызывает reload при controllerchange, а sw.js использует skipWaiting/clients.claim. Проверка реального callback с mock window подтвердила отсутствие проверки dirty draft; потеря черновика при настоящем обновлении браузера отдельно не воспроизводилась. TaskComposer хранит ввод в React state. Нужны сохранение черновиков или предложение применить обновление после завершения ввода.

## Необходимый рефакторинг

| Область               | Наблюдение                                                                                 | Направление работы                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Авторизация           | API, Alice и MCP расходятся в проверке сессий/ротации                                      | Общий security contract; отдельные transport-адаптеры; отрицательные сценарии для каждого входа |
| Офлайн-синхронизация  | Пять реализаций имеют разные гарантии purge, in-flight writes и блокировок между вкладками | Общий жизненный цикл команд и общие тесты гонок; доменные проекции оставить отдельными          |
| Legacy habits         | Недостижимый UI и hooks остаются в runtime-графе импортов; useHabits покрыт на 0,31% строк | Завершить миграцию и убрать неиспользуемую реализацию после проверки старых очередей/данных     |
| Self-care             | Repository 3448 строк, useSelfCare 2683, shared 2199                                       | Разделить чтение, SQL-запись, recurrence/projection, очередь и React orchestration              |
| Календарь и planner   | CalendarPage 1935 строк, offline-planner-store 2162, usePlannerState 1530                  | Выделять управление загрузкой/редактированием и хранением по устойчивым границам                |
| AI context            | Сервис 2807 строк                                                                          | Отделить выборку данных, права, coverage/truncation и форматирование ответов                    |
| Deploy/mobile release | 1825 и 1272 строки                                                                         | Выделить env contracts, rendering remote scripts, activation/rollback и artifact validation     |
| Файловые ресурсы      | Commit данных и удаление файлов смешаны                                                    | Явное владение файлом и повторяемый сборщик устаревших ресурсов                                 |

Размер файла не является самостоятельной ошибкой. Приоритет определяется найденными дефектами и сложностью проверки инвариантов. Новые production-зависимости для предложенных исправлений не требуются.

Поиск уборки и заботы ещё загружает полные наборы перед фильтрацией/пагинацией в памяти: [planner-search.service.ts:109](</Users/daryavedeneeva/ Projects  /Planner/apps/api/src/modules/planner-search/planner-search.service.ts:109>). Это риск роста времени и памяти; реальный предел нагрузки не измерен. SQL-пагинацию следует вводить после EXPLAIN/замеров на репрезентативных объёмах. Initial JS сейчас 786,9 KiB без сжатия при проходящем бюджете — основание измерить cold start на устройстве, не доказательство медленного интерфейса.

Stateless migration mode не имеет общей транзакции/advisory lock и повторяет отдельные statements после reconnect. Его следует считать ограниченным режимом совместимости; основной проверенный путь миграций транзакционный. Совместимость автоматического отката приложения после необратимой миграции требует отдельного контракта expand/contract.

## Проверки и их результаты

| Проверка                                                     | Результат                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| ESLint и time guard                                          | Прошли                                                                                                           |
| Prettier                                                     | Прошёл до создания отчёта; отчёт отформатирован отдельно                                                         |
| TypeScript web/contracts/API                                 | Прошёл                                                                                                           |
| Web unit                                                     | 147 файлов, 1404 теста прошли                                                                                    |
| API unit                                                     | 481 тест прошёл; начальный запуск упирался в sandbox localhost, повтор с доступом к локальному SMTP прошёл       |
| PostgreSQL 18                                                | 122 теста прошли; две opt-in проверки миграций затем отдельно прошли в дополнительной одноразовой БД — всего 124 |
| Pooler repository contracts                                  | 14 тестов прошли                                                                                                 |
| Скрипты backup/deploy/mobile/audit                           | 66 тестов прошли                                                                                                 |
| Playwright                                                   | 32/32, workers=1; desktop/mobile viewport, axe и имитация установленного mobile runtime                          |
| Android JVM unit                                             | 31 тест, 8 suites; свежий запуск без кэша результатов                                                            |
| Миграции                                                     | 115 SQL-файлов успешно применены к пустой PostgreSQL 18                                                          |
| RLS                                                          | Проверка non-owner runtime role прошла на отдельной БД                                                           |
| Production build и bundle budget                             | Прошли                                                                                                           |
| Knip strict, actionlint, OpenAPI, mobile config, prod config | Прошли; prod-config проверяет репозиторную конфигурацию, не работающий сервер                                    |
| npm audit, полный dependency graph                           | 0 известных advisories на момент запроса registry; 131 prod, 605 dev, всего 736 узлов                            |
| Toolchain                                                    | Не прошёл: установлен npm 12.2.1, требуется 12.2.2; Node 26.13.0 соответствует                                   |

Полный `npm run ci` единой командой не объявляется прошедшим: локальный toolchain gate остаётся красным. Основные проверки запускались отдельно. Coverage PostgreSQL и весь локальный iOS build в этом аудите не запускались.

Свежий web coverage: 73,46% строк, 68,18% ветвей; API unit coverage: 90,72% строк, 84,44% ветвей. API-метрика исключает PostgreSQL repository implementation и не означает такое покрытие всей серверной системы. Web hotspots: useSelfCare 81,54%, useSessionAuthController 84,28%, useShoppingList 72,95%, CalendarPage 75,59%, useWorkspaceParticipants 37,61%, legacy useHabits 0,31% строк. Процент покрытия не проверяет корректность требований: находки A01–A14 и их проверки демонстрируют пробелы сценариев при зелёных suites.

## CI и открытые сигналы безопасности

Для аудируемого SHA [GitHub CI](https://github.com/vedeneevadp-spec/Planner/actions/runs/43606372544) завершился успешно: quality, workflow lint, PostgreSQL 17, Android, iOS. [Security](https://github.com/vedeneevadp-spec/Planner/actions/runs/43606372513) также успешен. Это удалённые результаты соответствующего commit, отдельно от локальных прогонов.

В GitHub открыто 35 code-scanning alerts: 2 CodeQL и 33 Scorecard, включая 26 замечаний о закреплении зависимостей/actions и одно о permissions. Открытых Dependabot alerts — 0. Это не 35 подтверждённых эксплуатируемых уязвимостей.

CodeQL [48](https://github.com/vedeneevadp-spec/Planner/security/code-scanning/48) указывает на логирование release config: по текущему коду выводятся публичные параметры и имя auth provider, поэтому требуется triage возможного false positive. [47](https://github.com/vedeneevadp-spec/Planner/security/code-scanning/47) относится к Math.random в адресе smoke-аккаунта, не к токену реального пользователя. Стоит использовать случайные credentials и гарантированную cleanup. Для CI нужны явные минимальные token permissions и закрепление actions на проверенных SHA; правила обновления сохранить автоматизированными.

Недостающие проверки CI:

- Полный HTTP smoke собранного `dist/server.js` после удаления devDependencies под непривилегированным runtime DB login. Сейчас [smoke](</Users/daryavedeneeva/ Projects  /Planner/scripts/api-prod-smoke.mjs:67>) стартует исходники через tsx с owner URL; отдельный non-owner RLS check этот end-to-end контракт не заменяет.
- Реальный native bridge и refresh на Android/iOS; Playwright mobile-installed-auth использует браузерную имитацию. Android instrumentation-сценарии существуют, но соответствующий запуск не входит в проверенный CI job.
- Production PWA update с несохранённым вводом; текущий Playwright использует Vite dev server, где service worker выключен.
- Гонки purge/restore/in-flight writes, 201+ покупка, отказ файлового storage после commit и отсутствие mailbox verification.
- Проверка практической retention на временном restic repository и согласованности ссылок backup при параллельных изменениях assets.

## Что уже сделано хорошо

Строгий TypeScript, общие Zod-контракты, repository contract tests, parameterized SQL/RLS и проверка non-owner роли дают хорошую основу. Есть оптимистические версии задач, транзакции для повторений, защита Google nonce и привязки аккаунта, распределённые rate limits для основных auth/MCP путей, отдельные runtime-пользователи и env, systemd hardening, проверки production-конфигурации и подписей Android-обновлений.

Native credentials используют Android Keystore/AES-GCM и iOS Keychain; Android backup исключает credential storage. В просмотренных production web-исходниках не обнаружены dangerouslySetInnerHTML/innerHTML/eval. Ограниченная pattern-проверка 1382 tracked-файлов не нашла действующих ключей по использованным шаблонам; это не сканирование всей истории Git и не гарантия отсутствия любых секретов.

## Порядок исправлений

1. **Доступ и целостность:** A01, A02, A03; A04 до следующего iOS выпуска. Каждое исправление сопровождается регрессией воспроизведённого сценария.
2. **Остальные активные дефекты:** A05–A07, A09–A14. Закрытие dev-порта и выравнивание npm — небольшие самостоятельные изменения; retention сначала проверять dry-run.
3. **Устойчивость и проверяемость:** deadline, PWA drafts, smoke production artifact/non-owner, native instrumentation, backup consistency tests.
4. **Структура:** общий lifecycle offline-команд, общий auth contract, удаление legacy habits (A08), разделение крупных self-care/AI/deploy модулей. Делать небольшими изменениями с сохранением контрактов, а не одним масштабным PR.

## Границы аудита и материалы

Не проверены текущие production env/права файлов/таймеры, фактический restic repository и успешное disaster recovery, внешняя достижимость БД, real SMTP/FCM/Google/Yandex end-to-end, физические Android/iOS, нагрузка и полный поиск секретов в истории Git. Наличие репозиторной защиты не доказывает её применение на сервере. Подтверждённых P0 в проведённых проверках нет; это не гарантия отсутствия других уязвимостей.

[Машиночитаемые результаты](2026-11-15-full-project-audit-evidence.json) содержат сводку проверок и пути к материалам. Логи, безопасные repro и скриншоты сохранены локально в [каталоге аудита](</Users/daryavedeneeva/ Projects  /Planner/tmp/audit-2026-11-15>). Repro offline-очередей: [audit-web-mobile-20261115.mts](</Users/daryavedeneeva/ Projects  /Planner/tmp/audit-web-mobile-20261115.mts>). Временные БД и серверы аудита остановлены после завершения проверок. Единственные добавленные постоянные файлы — этот отчёт и JSON-доказательства.

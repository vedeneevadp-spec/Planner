# Цикл разработки и релиза

Документ описывает текущий рабочий путь проекта от локальной разработки до
доставки изменений пользователю через:

- web production на `https://chaotika.ru`
- installable `PWA`
- нативные iOS/Android приложения через Capacitor

Для первичной настройки production VPS используйте
[DEPLOY_RU.md](../DEPLOY_RU.md). Этот документ фокусируется на повторяемом
workflow релиза.

## Каналы доставки

| Канал             | Как пользователь получает обновление                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| Web               | сразу после `npm run deploy:prod` и обновления страницы                      |
| PWA               | через production web deploy; service worker обновляется при следующем заходе |
| iOS / Android app | только после нового native build и публикации в App Store / Google Play      |

Критичный вывод: production deploy обновляет web и PWA, но не обновляет уже
установленные store-приложения. В Capacitor сейчас нет live update-механизма,
поэтому UI-изменения для iOS/Android требуют новой публикации в store.

## Когда какой релиз нужен

| Тип изменения                     | Нужен production deploy | Нужен store release | Дополнительно                              |
| --------------------------------- | ----------------------- | ------------------- | ------------------------------------------ |
| Backend-only, без breaking change | да                      | нет                 | проверить API smoke                        |
| Web UI / UX / маршруты            | да                      | да                  | `mobile:sync` перед native build           |
| PWA manifest / service worker     | да                      | нет                 | проверить install/update flow              |
| Иконки / splash / branding native | нет                     | да                  | `npm run mobile:assets`                    |
| SQL schema / backend contract     | да                      | иногда              | применить migrations до/во время релиза    |
| Capacitor plugin / permissions    | возможно                | да                  | проверить Xcode / Android Studio настройки |

Store release не нужен только тогда, когда установленное нативное приложение
продолжает корректно работать с новым backend без изменений встроенного web
bundle и native shell.

## 1. Поднять локальную среду

Локальный Postgres runtime:

```bash
npm ci
npm run db:setup
npm run dev:api
npm run dev
```

Что проверить:

1. web открывается локально через Vite
2. API отвечает на `/api/health`
3. авторизация и основные сценарии работают на нужном runtime

Если задача затрагивает только UI и browser runtime, этого шага обычно
достаточно для основной разработки.

## 2. Разрабатывать и проверять feature в web

Базовый рабочий цикл:

1. писать код и проверять сценарий в `npm run dev`
2. если меняется API или схема, обновить backend и миграции
3. если меняется brand asset для native app, заменить `assets/logo.png`
4. перед фиксацией прогнать локальные проверки

Минимальный набор проверок:

```bash
npm run lint
npm run test:web:run
npm run build
```

Полный локальный гейт:

```bash
npm run check
```

Если релиз затрагивает backend schema, `npm run deploy:prod` сам миграции не
запускает. Production schema нужно обновить отдельным осознанным шагом против
целевого PostgreSQL:

```bash
DATABASE_URL="postgres://..." npm run db:migrate
```

Для текущего production окружения это обычно безопаснее делать на VPS, чтобы
использовать тот же сетевой контур и `/etc/planner/planner.env`:

```bash
ssh root@147.45.158.186
cd /opt/planner
set -a
. /etc/planner/planner.env
set +a
npm run db:migrate
```

Этот шаг нужно делать только против целевой production/staging базы.

## 3. Проверить production browser build и PWA локально

Service worker регистрируется только в production browser build, поэтому PWA не
проверяется через обычный `npm run dev`.

Локальная проверка:

```bash
npm run build
npm run preview
```

Что проверить:

1. приложение открывается через preview build
2. `manifest.webmanifest` доступен
3. install prompt / Add to Home Screen работает в поддерживаемом браузере
4. после повторного открытия PWA подхватывает production bundle и service worker

Если релиз меняет только PWA/runtime browser behavior, до этого шага можно не
открывать native IDE.

## 4. Проверить мобильную оболочку через Capacitor

Для нативной проверки нужен API, доступный эмулятору или устройству. Значение
`http://127.0.0.1:3001` годится только для браузера на той же машине.

Практические варианты:

- Android emulator: `VITE_API_BASE_URL=http://10.0.2.2:3001`
- физическое устройство: публичный `https` URL backend
- staging/prod mobile smoke: staging/prod `https` URL

Если менялись иконки или splash:

```bash
npm run mobile:assets
```

Синхронизация web bundle в native проекты:

```bash
VITE_API_BASE_URL=https://chaotika.ru npm run mobile:sync
```

Открыть проекты в IDE:

```bash
npm run mobile:open:ios
npm run mobile:open:android
```

Что проверить на симуляторе или устройстве:

1. запуск приложения
2. логин и session bootstrap
3. навигация и safe-area
4. работа с offline snapshots и очередью
5. сетевые сценарии на реальном backend URL

## 5. Подготовить release candidate

Перед релизом собрать минимальный чек-лист:

1. `npm run check`
2. `npm run mobile:doctor`, если планируется store release
3. production env готов для backend и web runtime
4. production migrations уже применены, если релиз меняет schema
5. иконки и splash пересобраны, если менялся брендинг

Если релиз включает store build, обновить версии native приложений.

Android:

- файл: `android/app/build.gradle`
- увеличить `versionCode`
- обновить `versionName`

Текущие значения по умолчанию:

```text
versionCode 1
versionName "1.0"
```

iOS:

- проект: `ios/App/App.xcodeproj`
- увеличить `CURRENT_PROJECT_VERSION`
- обновить `MARKETING_VERSION`

Текущие значения по умолчанию:

```text
CURRENT_PROJECT_VERSION = 1
MARKETING_VERSION = 1.0
```

Версии нужно менять перед каждой публикацией нового build в store.

## 6. Выкатить web и PWA в production

Первичная настройка production сервера описана в
[DEPLOY_RU.md](../DEPLOY_RU.md). Для обычного повторного релиза основной шаг
один:

```bash
npm run deploy:prod
```

Что делает скрипт:

1. предупреждает о dirty worktree
2. запускает `npm run check`, если не указан `--skip-checks`
3. синхронизирует проект на VPS
4. собирает production web с `VITE_API_BASE_URL=https://chaotika.ru`
5. перезапускает API и reload-ит Caddy
6. проверяет `http://127.0.0.1:3001/api/health`
7. проверяет `https://chaotika.ru/api/health`

После deploy проверить вручную:

1. `https://chaotika.ru`
2. `https://chaotika.ru/api/health`
3. логин
4. основные пользовательские экраны
5. PWA install/open flow в production браузере

## 7. Выпустить iOS и Android build

Этот шаг нужен только если изменения должны дойти до пользователей store-app.

Большую часть подготовки можно автоматизировать одной командой:

```bash
npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2
```

Что делает команда:

1. обновляет `versionName` / `MARKETING_VERSION`
2. обновляет `versionCode` / `CURRENT_PROJECT_VERSION`
3. при необходимости может пересобрать native assets через флаг `--assets`
4. выполняет `mobile:sync` с указанным `VITE_API_BASE_URL`
5. при флаге `--open=ios|android|all` может сразу открыть IDE

Если нужен не только sync, но и сборка release-артефактов:

```bash
npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2 --build-artifacts=all --android-format=bundle
```

Дополнительно:

- `--build-artifacts=android|ios|all` включает native build после sync
- `--android-format=apk|bundle|both` выбирает формат Android release
- `--ios-export-options=ios/ExportOptions.plist` после archive экспортирует IPA
- `--android-sdk=...` позволяет явно указать SDK, если он не найден
- `--ios-developer-dir=...` позволяет явно указать полный Xcode developer dir

Для RuStore удобнее отдельная команда под signed APK:

```bash
npm run mobile:release:rustore -- --api-url=https://chaotika.ru --version=1.0.1 --build=2
```

Перед первым запуском нужно настроить release signing:

1. создать `android/keystore.properties` из `android/keystore.properties.example`
2. положить keystore, например, в `android/keystore/chaotika-upload.jks`
3. заполнить:

```text
storeFile=keystore/chaotika-upload.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Альтернатива: вместо файла передать те же значения через env:

```bash
ANDROID_KEYSTORE_PATH=/absolute/path/to/chaotika-upload.jks
ANDROID_KEYSTORE_PASSWORD=...
ANDROID_KEY_ALIAS=...
ANDROID_KEY_PASSWORD=...
```

После успешной сборки signed APK лежит в:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Примеры:

```bash
npm run mobile:release -- --api-url=https://staging.chaotika.ru --build=15
npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2 --open=ios
npm run mobile:release -- --api-url=https://chaotika.ru --version=1.1.0 --build=7 --assets --open=all
```

Базовый поток:

1. выставить production или staging `VITE_API_BASE_URL`
2. выполнить `npm run mobile:sync`
3. открыть Xcode / Android Studio
4. обновить version/build number
5. собрать release build
6. загрузить его в TestFlight / App Store Connect и Google Play Console
7. пройти smoke-проверку на собранном release build
8. отправить на review / rollout

По текущему состоянию репозитория публикация store build не автоматизирована:

- signing выполняется в Xcode / Android Studio
- upload в App Store Connect / Google Play выполняется вручную
- CI/CD для native release в репозитории пока нет

Текущая one-command автоматизация покрывает:

- version/build bump
- asset regeneration
- `mobile:sync`
- Android `assembleRelease` / `bundleRelease`
- iOS `xcodebuild archive`
- optional `xcodebuild -exportArchive`, если передан `ExportOptions.plist`

Она не покрывает:

- настройку signing certificates / provisioning profiles
- первый запуск Xcode (`sudo xcodebuild -runFirstLaunch`)
- upload в stores

Это значит, что `npm run deploy:prod` и web rollout можно сделать отдельно от
store release. Если релиз срочный, backend и web можно выкатить сразу, а native
пакеты отправить позже, если они остаются совместимыми.

## 8. Пост-релизная проверка

После любого production rollout:

1. открыть production web
2. проверить `GET /api/health`
3. пройти логин и один основной пользовательский сценарий
4. проверить, что PWA ставится и открывается

После store release дополнительно:

1. установить release build из TestFlight / internal testing
2. проверить старт приложения на чистом устройстве
3. проверить авторизацию
4. проверить, что приложение работает с production backend
5. убедиться, что version/build number совпадает с релизным планом

## Короткий чек-лист по типам релизов

### Только backend fix

1. локально проверить API
2. если нужна schema change, применить production migrations
3. `npm run deploy:prod`
4. smoke production web и API

### Web/PWA релиз

1. `npm run check`
2. `npm run build && npm run preview`
3. `npm run deploy:prod`
4. проверить production web и PWA

### Полный релиз с iOS/Android

1. `npm run check`
2. `npm run mobile:assets`, если менялся branding
3. `VITE_API_BASE_URL=<reachable-url> npm run mobile:sync`
4. обновить native version numbers
5. `npm run deploy:prod`
6. собрать и загрузить store builds
7. проверить production web, PWA и release build на устройстве

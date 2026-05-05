# RuStore resubmission checklist

## Why moderation rejected the build

The moderator reported two issues:

- the app looked like a WebView wrapper whose main purpose is opening the web
  site;
- the app showed "Сервис временно недоступен" during launch.

RuStore allows an app to duplicate web functionality or use WebView for some
flows, but the app must feel like a complete standalone product. If login is
required, moderators must be able to pass it, and limited-audience apps need
test credentials in the moderation comment.

## Before uploading a new APK

1. Make sure production is healthy:

   ```bash
   curl -fsS https://chaotika.ru/api/health
   ```

   The response must contain `"status":"ok"` and `"databaseStatus":"up"`.

2. Build the RuStore APK only after the health check passes:

   ```bash
   npm run mobile:release:rustore -- --api-url=https://chaotika.ru --version=1.0.3 --build=3
   ```

   The release script now checks `GET /api/health` before syncing and building.

3. Smoke-test the exact APK from:

   ```text
   android/app/build/outputs/apk/release/app-release.apk
   ```

   Check a clean install and a reinstall over the previous rejected build.

4. Verify the APK opens the local Capacitor bundle, not the public web site:
   - `capacitor.config.ts` must not contain `server.url`;
   - the app should still open its login/product screen if `chaotika.ru` root is
     unavailable;
   - only backend API calls should go to `https://chaotika.ru/api/...`.

5. Prepare test credentials for moderators. The account should already contain
   several tasks, a shopping list, spheres/projects, and a reminder/push flow if
   push notifications are declared in the listing.

## Moderation comment template

```text
Приложение Chaotika — самостоятельный мобильный планер, а не перенаправление на сайт. APK собран через Capacitor с локально упакованной web-сборкой; в capacitor.config.ts не используется server.url. В интернет приложение обращается только к backend API https://chaotika.ru/api/... для авторизации, синхронизации задач, списков покупок, пространств и push-уведомлений.

Для проверки:
Email: <test-email>
Password: <test-password>

В тестовом аккаунте уже есть задачи на сегодня/завтра, список покупок, сферы и проекты. Основные сценарии: вход, создание задачи, перенос задачи на завтра, отметка выполнения, список покупок, переключение разделов, выход из аккаунта.
```

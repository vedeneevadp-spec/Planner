# Вход через Google

Сайт использует Google Identity Services, Android — Credential Manager и
`GetSignInWithGoogleOption`. Сервер проверяет подпись Google ID token через
JWKS, `iss`, `aud`, срок действия, подтверждение email и одноразовый `nonce`.
После проверки выдаётся обычная сессия Chaotika: HttpOnly refresh-cookie в
браузере, защищённое native-хранилище на Android. Google access/refresh tokens
не запрашиваются и не сохраняются.

## Подключение Google Cloud

Google Cloud / Firebase проект приложения — `chaotika-58761`.
14 ноября 2026 года в Google Auth Platform созданы три OAuth-клиента:

| Клиент                   | Client ID                                                                  |
| ------------------------ | -------------------------------------------------------------------------- |
| Chaotika Web             | `843404819612-mp9h5qtdlco112p7b5vs602l0l0gvuvv.apps.googleusercontent.com` |
| Chaotika Android release | `843404819612-jlospvtdjdcfqp1s4ca8fgkb4ct70h9j.apps.googleusercontent.com` |
| Chaotika Android debug   | `843404819612-01ctltqbrscnrabp6f8icpegm90mkimo.apps.googleusercontent.com` |

Web origin — только `https://chaotika.ru`. Поддержка для экрана согласия —
`tikondra47@gmail.com` (подтверждено владельцем). Домашняя страница —
`https://chaotika.ru`, политика — `https://chaotika.ru/privacy.html`,
авторизованный домен — `chaotika.ru`. Сохранены базовые scopes `openid`,
`userinfo.email`, `userinfo.profile`; sensitive/restricted scopes отсутствуют.
Android получает Web client ID от API; добавлять client secret или OAuth-поля
в `google-services.json` для этого плагина не нужно.

Audience переведена в `In production` / `External`: список тестовых пользователей
не ограничивает вход. Google Verification centre подтверждает, что проверка
доступа к данным не требуется для выбранных scopes. Проверка брендинга отдельно
не пройдена; отображение названия приложения в Google пока не подтверждено.

Подписи Android проверены через Gradle и Google Play Console:

| Клиент                        | Пакет             | SHA-1                                                         |
| ----------------------------- | ----------------- | ------------------------------------------------------------- |
| Android release / Google Play | `ru.chaotika.app` | `9A:96:73:E6:07:79:DE:72:D9:28:52:E6:95:9B:D4:24:FF:8D:B1:5A` |
| Android debug                 | `ru.chaotika.app` | `F0:D2:FF:90:32:49:92:4D:76:66:42:FE:6E:13:D7:0F:C8:79:F2:3A` |

SHA-256 ключа подписи приложения в Google Play совпадает с release-ключом:
`2E:1F:24:F6:72:74:1D:48:00:91:E6:75:6B:BB:90:66:6E:53:24:EB:1D:1D:8E:52:9F:AE:53:00:7C:13:BB:3D`.
Один Android release-клиент подходит для APK и установки из Google Play.
Ключ загрузки AAB для входа не используется.

1. В Google Auth Platform того же проекта настроить Branding и Audience:
   имя Chaotika, адрес поддержки, домен `chaotika.ru`, актуальные ссылки на
   главную страницу и политику конфиденциальности. Пока приложение в Testing,
   добавить Google-аккаунты проверяющих в Test users.
2. Создать OAuth-клиент **Web application**. В Authorized JavaScript origins
   указать `https://chaotika.ru`. Для локальной проверки добавить отдельный
   origin, например `http://localhost:5173`, с фактическим портом dev-сервера.
   Используется popup с JS callback, redirect URI и client secret этой
   реализации не нужны. Web client ID передаётся также Android как server client ID.
3. Создать Android OAuth-клиенты для пакета `ru.chaotika.app` и SHA-1 каждого
   фактически используемого сертификата: debug, direct/RuStore release и
   **App signing key certificate** из Google Play Console. Для установленного
   из Play приложения нужен ключ подписи Google Play, а не upload key.
4. Применить миграции `20261114_000112_google_sign_in.sql` и
   `20261114_000113_google_sign_in_backup.sql`, настроить runtime DB role.
   Миграции выдают права существующему `planner_runtime` и разрешают чтение
   существующей роли резервного копирования `planner_backup`;
   `db:runtime-role:setup` поддерживает создание роли после миграции и другое имя.
5. Установить серверную переменную
   `AUTH_GOOGLE_CLIENT_ID=<web-client-id>.apps.googleusercontent.com` и
   перезапустить API. При пустом значении кнопка скрыта, попытки входа получают
   `auth_google_disabled`. Client ID публичный; Google client secret не нужен.
6. Обновить web и Caddy: CSP разрешает необходимые адреса GIS, а
   `Cross-Origin-Opener-Policy: same-origin-allow-popups` поддерживает popup.
7. Для Android собрать новую версию с web-ресурсами и native-плагином.
   Старая APK без `PlannerGoogleSignIn` не показывает кнопку Google.

Для входа используются только данные идентификации Google. Доступ к Gmail,
Drive или Calendar не запрашивается. Перед выпуском обновить сведения о
способах создания аккаунта в Google Play Console: теперь доступен и Google.

## Аккаунты и восстановление

- Связь хранится по постоянному Google `sub`. Изменение Google email не
  создаёт новый профиль и не переносит связь на чужой аккаунт.
- Если email уже есть в Chaotika, первая привязка требует текущий пароль
  Chaotika. Данные, роли и ID сохраняются. Автоматического объединения по
  совпавшему email нет. Если пароль забыт, сначала используется существующее
  восстановление по email.
- Новый пользователь получает профиль без известного пароля. Служебный
  маркер `external:google` не проходит проверку scrypt. Восстановление по
  email позволяет позднее установить обычный пароль.
- К аккаунту привязывается один Google subject. Удалённый аккаунт не
  восстанавливается Google-входом. Выход отзывает сессию Chaotika и очищает
  состояние Credential Manager; Google-аккаунт на устройстве не удаляется.
- Попытка входа действует 10 минут, привязана к устройству и может быть
  завершена один раз. PostgreSQL атомарно защищает от повторов и параллельного
  создания одного профиля. Ошибочная привязка не расходует попытку.

## Проверка

```sh
npm run lint
npm run typecheck
node --import tsx --test apps/api/src/modules/auth/google-auth.service.test.ts apps/api/src/modules/auth/google-auth.routes.test.ts
node --import tsx --test apps/api/src/modules/auth/google-auth.repository.postgres-spec.ts
npm run test:web:run -- GoogleSignIn.test.tsx AuthGate.test.tsx SessionProvider.test.tsx mobile-auth-regression-gate.test.tsx auth-api.test.ts
npm run build
cd android
./gradlew --no-daemon :app:compileDebugJavaWithJavac :app:testDebugUnitTest
```

Автотесты проверяют подпись и claims на локальных RSA-ключах, одноразовость,
привязку, cookie/native transport и сохранение сессии. Они не подтверждают
настройку Google Cloud или работу выбора реального аккаунта на телефоне.
После настройки клиентов отдельно проверить новый аккаунт, существующий
аккаунт, отмену, выход/повторный вход, перезапуск Android и сборку из Google Play.

Официальная документация:

- [Google Identity Services для сайта](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
- [Серверная проверка Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
- [Вход через Credential Manager на Android](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation).

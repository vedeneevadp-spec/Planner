# Production Deploy: Planner на Timeweb

Инструкция описывает текущий production target проекта.

```text
Домен: chaotika.ru
VPS: 147.45.158.186
Database: Timeweb Managed PostgreSQL `Brainy Amalthea`
Локальный проект: /Users/daryavedeneeva/ Projects  /Planner
Production root: /opt/planner
Production env: /etc/planner/planner.env
Icon assets: /var/lib/planner/icon-assets
```

После настройки сайт открывается на `https://chaotika.ru`, API доступен под тем
же доменом, например `https://chaotika.ru/api/health`.

## Что важно

- Web-сайт и API живут на VPS за Caddy.
- База приложения живет в Timeweb Managed PostgreSQL.
- Supabase пока используется только для Auth/JWT, но не как production data
  store.
- UI не ходит в Postgres напрямую: все чтение и запись идут через backend API.
- Supabase Realtime не является production dependency; web синхронизируется
  через `/api/v1/task-events`.
- Загруженные иконки emoji library хранятся в локальной папке API:
  `/var/lib/planner/icon-assets`.
- Повторные выкладки выполняются локально командой `npm run deploy:prod`.

## 1. Проверить DNS

На Mac:

```bash
dig +short chaotika.ru
```

Ожидаемый результат:

```text
147.45.158.186
```

Если вывод пустой или там другой IP, в Timeweb должна быть A-запись:

```text
Тип: A
Имя: @
Значение: 147.45.158.186
```

Для `www.chaotika.ru` можно добавить CNAME:

```text
Тип: CNAME
Имя: www
Значение: chaotika.ru
```

HTTPS нормально выпустится только после того, как DNS указывает на VPS.

## 2. Подготовить сервер один раз

Подключиться к серверу:

```bash
ssh root@147.45.158.186
```

Установить системные зависимости:

```bash
apt update
apt upgrade -y
apt install -y curl git ufw caddy rsync
```

Установить Node.js 24:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v
npm -v
```

Включить firewall:

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

Создать пользователя и рабочие директории:

```bash
useradd --system --create-home --shell /usr/sbin/nologin planner || true
mkdir -p /opt/planner /etc/planner /var/lib/planner/icon-assets
chown -R planner:planner /opt/planner /var/lib/planner
chmod 750 /etc/planner
```

## 3. Создать production env

На сервере нужен файл:

```text
/etc/planner/planner.env
```

Базовый шаблон есть в `.env.production.example`. Для текущего deploy нужны
такие значения:

```text
NODE_ENV=production
API_AUTH_MODE=supabase
API_STORAGE_DRIVER=postgres
API_DB_RLS_MODE=disabled
API_HOST=127.0.0.1
API_PORT=3001
API_CORS_ORIGIN=https://chaotika.ru,https://localhost,capacitor://localhost
API_ICON_ASSET_DIR=/var/lib/planner/icon-assets
DATABASE_URL=<Timeweb Managed PostgreSQL URL>
SUPABASE_URL=<https://project-ref.supabase.co>
SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_JWT_SECRET=
FIREBASE_SERVICE_ACCOUNT_PATH=/etc/planner/firebase-service-account.json
```

`DATABASE_URL` должен указывать на Timeweb PostgreSQL, например:

```text
postgresql://gen_user:<password>@<public-db-host>:5432/default_db?sslmode=require&uselibpqcompat=true
```

Timeweb firewall для Managed PostgreSQL должен разрешать входящий `TCP 5432`
только с production VPS `147.45.158.186/32`. Если база недоступна по публичному
адресу, production VPS должен быть подключен к той же приватной сети, что и
кластер PostgreSQL.

Для Supabase Auth значения `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` и при
наличии `SUPABASE_JWT_SECRET` остаются из Supabase project settings.

На сервере создать файл:

```bash
nano /etc/planner/planner.env
```

После сохранения выставить права:

```bash
chown root:planner /etc/planner/planner.env
chmod 640 /etc/planner/planner.env
```

## 4. Первый deploy

На Mac:

```bash
cd "/Users/daryavedeneeva/ Projects  /Planner"
npm run deploy:prod
```

Скрипт делает следующее:

```text
1. Проверяет рабочее дерево и предупреждает о незакоммиченных изменениях.
2. Запускает npm run check.
3. Создает/проверяет production-директории на сервере.
4. Копирует проект через rsync.
5. Копирует apps/api/tmp/icon-assets, если папка есть.
6. На сервере запускает npm ci --include=dev --ignore-scripts и затем
   точечно rebuild для install-скриптов, нужных сборке/runtime. Это не дает
   dev-пакету supabase скачивать CLI с GitHub во время production deploy.
7. Собирает web с VITE_API_BASE_URL=https://chaotika.ru.
8. Копирует deploy/systemd/planner-api.service.
9. Копирует deploy/caddy/Caddyfile.
10. Перезапускает planner-api.
11. Валидирует и перезагружает Caddy.
12. Проверяет http://127.0.0.1:3001/api/health и https://chaotika.ru/api/health.
```

После успешного deploy проверить:

```bash
curl https://chaotika.ru/api/health
```

Ожидаемый фрагмент ответа:

```text
"status":"ok"
```

Один раз после первого deploy включить автозапуск API после reboot:

```bash
ssh root@147.45.158.186 "systemctl enable planner-api && systemctl enable caddy"
```

## 5. Настроить Supabase Auth redirects

В Supabase Dashboard:

```text
Authentication -> URL Configuration
```

Production:

```text
Site URL: https://chaotika.ru
Redirect URLs: https://chaotika.ru/**
```

Для локальной разработки можно оставить:

```text
http://localhost:5173/**
http://127.0.0.1:5173/**
```

## Частые команды deploy

Обычное обновление:

```bash
npm run deploy:prod
```

Без локальных проверок:

```bash
npm run deploy:prod -- --skip-checks
```

Без копирования локальных иконок:

```bash
npm run deploy:prod -- --skip-icons
```

Dry run:

```bash
npm run deploy:prod -- --dry-run
```

Переопределения через env:

```bash
DEPLOY_HOST=root@147.45.158.186
DEPLOY_DOMAIN=chaotika.ru
DEPLOY_REMOTE_ROOT=/opt/planner
DEPLOY_ICON_REMOTE_DIR=/var/lib/planner/icon-assets
```

## SSH без пароля

Если локально настроен SSH alias `planner-prod`, ключ можно добавить так:

```bash
ssh-copy-id -i ~/.ssh/planner_timeweb_ed25519.pub planner-prod
ssh planner-prod "echo ok"
```

После этого можно запускать deploy с переопределением хоста:

```bash
DEPLOY_HOST=planner-prod npm run deploy:prod
```

## Диагностика

DNS:

```bash
dig +short chaotika.ru
```

API на сервере:

```bash
systemctl status planner-api
journalctl -u planner-api -n 100 --no-pager
curl http://127.0.0.1:3001/api/health
```

Caddy/HTTPS:

```bash
systemctl status caddy
journalctl -u caddy -n 100 --no-pager
caddy validate --config /etc/caddy/Caddyfile
curl https://chaotika.ru/api/health
```

Проверить production env:

```bash
grep -E '^(NODE_ENV|API_|DATABASE_URL|SUPABASE_)' /etc/planner/planner.env
```

Проверить файлы web build:

```bash
ls -la /opt/planner/apps/web/dist
```

Проверить локальные icon assets на сервере:

```bash
ls -la /var/lib/planner/icon-assets
```

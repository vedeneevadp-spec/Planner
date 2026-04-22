# Как выложить Planner на Timeweb: очень простая инструкция

Эта инструкция конкретно для твоей текущей ситуации:

```text
Домен: chaotika.ru
Сервер Timeweb: 147.45.158.186
Проект на Mac: /Users/daryavedeneeva/ Projects  /Planner
```

Что получится в конце:

```text
https://chaotika.ru
```

По этой ссылке будет открываться Planner. API будет работать внутри того же домена:

```text
https://chaotika.ru/api/health
```

Важно: сейчас приложение всё ещё использует Supabase для входа и базы. Сайт будет жить на российском сервере Timeweb, но регистрация/логин пока зависят от Supabase.

## Что уже готово

Ты уже сделала:

```text
1. Домен chaotika.ru выбран в Timeweb.
2. VPS Timeweb создан.
3. IP сервера: 147.45.158.186.
```

Теперь надо сделать 5 больших шагов:

```text
1. Проверить, что домен ведёт на сервер.
2. Подключиться к серверу.
3. Установить на сервер Node.js, Caddy и Git.
4. Скопировать проект на сервер и собрать сайт.
5. Запустить API и включить HTTPS.
```

## Шаг 1. Купить домен и привязать его к серверу

Открой Timeweb Cloud в браузере.

На скриншоте у `chaotika.ru` статус:

```text
Домен свободен
```

и есть кнопка:

```text
В корзину
```

Это значит, что домен ещё не куплен. Сначала его нужно зарегистрировать.

Что сделать в Timeweb:

```text
1. Нажми "В корзину".
2. Перейди в корзину.
3. Оплати регистрацию домена chaotika.ru.
4. Вернись на экран домена после оплаты.
```

На этом же экране уже видно:

```text
Привязан к сервису Mysterious Bittern
147.45.158.186
```

Это правильно. Значит домен должен вести на твой сервер.

После оплаты домена DNS может обновляться не сразу. Обычно это занимает от 5
минут до нескольких часов.

На Mac можно проверить так. Открой обычный Terminal и введи:

```bash
dig +short chaotika.ru
```

Хороший результат:

```text
147.45.158.186
```

Если команда ничего не вывела, домен ещё не активировался или DNS ещё не
обновился.

Если команда показывает другой IP, открой в Timeweb подсказку:

```text
Как изменить DNS-записи?
```

и проверь, что есть A-запись:

```text
Тип: A
Имя: @
Значение: 147.45.158.186
```

Если хочешь, чтобы открывался ещё и `www.chaotika.ru`, добавь вторую запись:

```text
Тип: CNAME
Имя: www
Значение: chaotika.ru
```

Дальше можно настраивать сервер, но HTTPS нормально заработает только когда
`dig +short chaotika.ru` покажет `147.45.158.186`.

## Шаг 2. Подключиться к серверу

Открой Terminal на Mac.

Введи:

```bash
ssh root@147.45.158.186
```

Если появится вопрос:

```text
Are you sure you want to continue connecting?
```

напиши:

```text
yes
```

и нажми Enter.

Потом введи пароль от сервера из Timeweb. Когда вводишь пароль, символы не показываются. Это нормально.

Если ты видишь строку примерно такую:

```text
root@...
```

значит ты внутри сервера.

Дальше команды из следующих шагов надо вводить уже в этом окне сервера.

## Шаг 3. Установить всё нужное на сервер

Скопируй и вставь эту команду на сервер:

```bash
apt update && apt upgrade -y
```

Потом эту:

```bash
apt install -y curl git ufw caddy rsync
```

Теперь установи Node.js:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
```

Потом:

```bash
apt install -y nodejs
```

Проверь, что Node установился:

```bash
node -v
```

Должно показать что-то вроде:

```text
v24.x.x
```

Проверь npm:

```bash
npm -v
```

## Шаг 4. Включить firewall

На сервере введи:

```bash
ufw allow OpenSSH
```

Потом:

```bash
ufw allow 80
```

Потом:

```bash
ufw allow 443
```

Потом:

```bash
ufw enable
```

Если спросит:

```text
Command may disrupt existing ssh connections. Proceed with operation?
```

напиши:

```text
y
```

и нажми Enter.

## Шаг 5. Создать папки для Planner на сервере

На сервере введи:

```bash
useradd --system --create-home --shell /usr/sbin/nologin planner || true
```

Потом:

```bash
mkdir -p /opt/planner /etc/planner /var/lib/planner/icon-assets
```

Потом:

```bash
chown -R planner:planner /opt/planner /var/lib/planner
```

Потом:

```bash
chmod 750 /etc/planner
```

## Шаг 6. Скопировать проект с Mac на сервер

Теперь нужно вернуться в Terminal на Mac, не в сервер.

Если ты всё ещё внутри сервера, напиши:

```bash
exit
```

Теперь ты снова на Mac.

Перейди в проект:

```bash
cd "/Users/daryavedeneeva/ Projects  /Planner"
```

Скопируй проект на сервер:

```bash
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude apps/web/dist \
  --exclude coverage \
  --exclude tmp \
  --exclude .env \
  --exclude .env.local \
  --exclude .env.supabase.local \
  ./ root@147.45.158.186:/opt/planner/
```

Отдельно скопируй загруженные картинки/иконки. Это важно: база хранит ссылки на
них, а сами файлы лежат не в Supabase, а в локальной папке API.

На Mac:

```bash
rsync -az apps/api/tmp/icon-assets/ root@147.45.158.186:/var/lib/planner/icon-assets/
```

Если попросит пароль, введи пароль от сервера Timeweb.

После копирования снова зайди на сервер:

```bash
ssh root@147.45.158.186
```

На сервере поправь права:

```bash
chown -R planner:planner /opt/planner
```

Потом поправь права на картинки:

```bash
chown -R planner:planner /var/lib/planner/icon-assets
```

## Шаг 7. Установить зависимости проекта на сервере

На сервере введи:

```bash
cd /opt/planner
```

Потом:

```bash
sudo -u planner env HUSKY=0 npm ci --include=dev
```

Это может занять несколько минут.

Если команда закончилась без красной ошибки, всё хорошо.

## Шаг 8. Создать секретный env-файл для сервера

Нужно создать файл:

```text
/etc/planner/planner.env
```

Сначала на сервере открой редактор:

```bash
nano /etc/planner/planner.env
```

Откроется пустой файл.

Теперь надо вставить туда production-настройки.

Чтобы получить готовый текст настроек, открой НОВЫЙ Terminal на Mac, не на сервере.

На Mac введи:

```bash
cd "/Users/daryavedeneeva/ Projects  /Planner"
```

Потом введи эту длинную команду:

```bash
node --env-file=.env.supabase.local --input-type=module -e 'import { getSupabaseRuntimeDatabaseUrl } from "./scripts/supabase-utils.mjs"; console.log(["NODE_ENV=production","API_AUTH_MODE=supabase","API_STORAGE_DRIVER=postgres","API_DB_RLS_MODE=disabled","API_HOST=127.0.0.1","API_PORT=3001","API_CORS_ORIGIN=https://chaotika.ru","API_ICON_ASSET_DIR=/var/lib/planner/icon-assets","DATABASE_URL=" + getSupabaseRuntimeDatabaseUrl(),"SUPABASE_URL=" + process.env.SUPABASE_URL,"SUPABASE_PUBLISHABLE_KEY=" + process.env.SUPABASE_PUBLISHABLE_KEY,"SUPABASE_JWT_SECRET=" + (process.env.SUPABASE_JWT_SECRET ?? "")].join("\n"))'
```

Она напечатает текст вида:

```text
NODE_ENV=production
API_AUTH_MODE=supabase
...
```

Скопируй весь напечатанный текст.

Вернись в окно сервера, где открыт `nano`, и вставь этот текст.

Сохранить файл в nano:

```text
Ctrl + O
Enter
Ctrl + X
```

Потом на сервере задай права на файл:

```bash
chown root:planner /etc/planner/planner.env
```

Потом:

```bash
chmod 640 /etc/planner/planner.env
```

## Шаг 9. Собрать web-сайт на сервере

На сервере введи:

```bash
cd /opt/planner
```

Потом вставь эту команду целиком:

```bash
sudo -u planner env \
  VITE_API_BASE_URL=https://chaotika.ru \
  VITE_SUPABASE_URL="$(grep '^SUPABASE_URL=' /etc/planner/planner.env | cut -d= -f2-)" \
  VITE_SUPABASE_PUBLISHABLE_KEY="$(grep '^SUPABASE_PUBLISHABLE_KEY=' /etc/planner/planner.env | cut -d= -f2-)" \
  npm run build
```

Если в конце видишь примерно:

```text
built in ...
```

значит сайт собрался.

Проверь, что папка сайта есть:

```bash
ls -la /opt/planner/apps/web/dist
```

Если видишь `index.html`, всё хорошо.

## Шаг 10. Запустить API как сервис

На сервере введи:

```bash
cp /opt/planner/deploy/systemd/planner-api.service /etc/systemd/system/planner-api.service
```

Потом:

```bash
systemctl daemon-reload
```

Потом:

```bash
systemctl enable --now planner-api
```

Проверь статус:

```bash
systemctl status planner-api
```

Хорошо, если видишь:

```text
active (running)
```

Чтобы выйти из просмотра статуса, нажми:

```text
q
```

Проверь API:

```bash
curl http://127.0.0.1:3001/api/health
```

Хороший результат содержит:

```text
"status":"ok"
```

Если API не запустился, посмотреть ошибку можно так:

```bash
journalctl -u planner-api -n 100 --no-pager
```

## Шаг 11. Настроить Caddy для HTTPS и домена

На сервере скопируй готовый Caddyfile:

```bash
cp /opt/planner/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
```

Проверь конфиг:

```bash
cat /etc/caddy/Caddyfile
```

Там должен быть домен:

```text
chaotika.ru
```

Проверь Caddy:

```bash
caddy validate --config /etc/caddy/Caddyfile
```

Если ошибок нет, перезапусти Caddy:

```bash
systemctl reload caddy
```

Проверь сайт через API:

```bash
curl https://chaotika.ru/api/health
```

Хороший результат содержит:

```text
"status":"ok"
```

Теперь открой в браузере:

```text
https://chaotika.ru
```

## Шаг 12. Настроить Supabase, чтобы вход работал

Открой Supabase Dashboard в браузере.

Дальше:

```text
1. Выбери проект Planner.
2. Слева открой Authentication.
3. Открой URL Configuration.
4. В Site URL вставь https://chaotika.ru
5. В Redirect URLs добавь https://chaotika.ru/**
6. Нажми Save.
```

Для локальной разработки можно оставить ещё:

```text
http://localhost:5173/**
http://127.0.0.1:5173/**
```

## Шаг 13. Финальная проверка

Открой:

```text
https://chaotika.ru
```

Проверь:

```text
1. Страница открывается.
2. Можно зарегистрироваться или войти.
3. Можно создать задачу.
4. После обновления страницы задача остаётся.
5. С телефона сайт тоже открывается.
```

## Как обновлять сайт потом

Когда ты изменила код на Mac и хочешь обновить сервер, теперь используй одну
команду.

На Mac:

```bash
cd "/Users/daryavedeneeva/ Projects  /Planner"
```

Потом:

```bash
npm run deploy:prod
```

Эта команда сама делает:

```text
1. Проверяет код: lint, typecheck, tests.
2. Копирует проект на сервер.
3. Копирует локальные картинки/иконки, если они есть.
4. На сервере запускает npm ci --include=dev.
5. Собирает web для https://chaotika.ru.
6. Перезапускает API.
7. Перезагружает Caddy.
8. Проверяет https://chaotika.ru/api/health.
```

Если нужно быстро выкатить маленькую правку без локальных проверок:

```bash
npm run deploy:prod -- --skip-checks
```

Если не нужно копировать локальные картинки:

```bash
npm run deploy:prod -- --skip-icons
```

Если хочешь посмотреть, что будет скопировано, но ничего не перезапускать:

```bash
npm run deploy:prod -- --dry-run
```

## Как убрать запрос пароля при деплое

На Mac уже должен быть отдельный SSH-ключ для production:

```text
~/.ssh/planner_timeweb_ed25519
```

Чтобы сервер начал его принимать, один раз выполни на Mac:

```bash
ssh-copy-id -i ~/.ssh/planner_timeweb_ed25519.pub planner-prod
```

Команда попросит пароль от сервера Timeweb. Введи его последний раз.

Проверь вход без пароля:

```bash
ssh planner-prod "echo ok"
```

Хороший результат:

```text
ok
```

После этого `npm run deploy:prod` тоже должен работать без запроса пароля.

## Если что-то не работает

### Сайт не открывается

На Mac проверь домен:

```bash
dig +short chaotika.ru
```

Должно быть:

```text
147.45.158.186
```

Если пусто или другой IP, проблема в DNS Timeweb.

### API не работает

На сервере:

```bash
systemctl status planner-api
```

Потом:

```bash
journalctl -u planner-api -n 100 --no-pager
```

### HTTPS не работает

На сервере:

```bash
systemctl status caddy
```

Потом:

```bash
journalctl -u caddy -n 100 --no-pager
```

### Вход перекидывает не туда

Проверь Supabase:

```text
Authentication -> URL Configuration
```

Там должно быть:

```text
Site URL: https://chaotika.ru
Redirect URLs: https://chaotika.ru/**
```

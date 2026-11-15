# Disaster recovery

## Цели и границы

Этот runbook покрывает production PostgreSQL и файловое хранилище
`API_ICON_ASSET_DIR`. Пользовательские JSON-архивы не являются заменой
инфраструктурному backup.

Начальные целевые показатели после включения automation:

- RPO: не более 25 часов при ежедневном backup и максимальной randomized
  задержке 30 минут;
- RTO: до 4 часов для восстановления базы, ассетов, проверки и переключения API;
- restore drill: не реже одного раза в месяц;
- offsite copy: обязательна для успешного production job.

Provider snapshots Timeweb могут быть дополнительным слоем, но их наличие,
расписание, retention и успешное восстановление этим репозиторием не
подтверждаются и в указанные RPO/RTO не засчитываются.

## Что реализовано

`npm run backup:create` создает атомарный backup set:

```text
<backup-id>/
  manifest.json
  postgres.dump
  assets/
```

Manifest содержит версию формата, backup ID, timestamps, host, app version,
commit, версию `pg_dump`, SHA-256 и размер dump, а также рекурсивный inventory
ассетов с SHA-256 и список файлов, на которые ссылается снимок БД. Symlink в
asset tree запрещен. Backup удерживает `REPEATABLE READ READ ONLY` transaction,
экспортирует snapshot и передает его `pg_dump --snapshot`; список ссылок
читается в той же transaction. До публикации набора выполняются checksum
validation, `pg_restore --list` и проверка наличия каждой ссылки в inventory.
Имена новых файлов уникальны и содержимое существующих файлов не перезаписывается.
Если API удалил старый файл во время копирования, backup завершается с ошибкой
и не публикует неполный набор. Следующий запуск снимает актуальные ссылки.

После локальной проверки set загружается Restic в offsite repository с tags
`planner`, `kind:infrastructure` и `backup-id:<id>`. Restic шифрует содержимое
до отправки.

Production systemd units:

- `planner-backup.timer`: ежедневно в 02:30, randomized delay до 30 минут;
- `planner-backup-prune.timer`: еженедельно в воскресенье в 04:30;
- `planner-restore-drill.timer`: первого числа месяца в 05:30;
- `planner-backup-alert@.service`: доставляет failure event в webhook/Telegram
  и использует SMTP fallback при сетевой ошибке.

Production deploy атомарно поддерживает `/etc/planner/release.env` со значением
`PLANNER_APP_COMMIT` активированного immutable release. Backup, prune и drill
units загружают этот файл, поэтому manifest можно связать с точным commit;
rollback возвращает значение commit предыдущего release.

Backup, prune, drill и deploy-time dump используют общий `flock`, поэтому не
работают параллельно.

## Retention

Значения по умолчанию:

- Restic: 14 daily, 8 weekly, 12 monthly snapshots;
- local infrastructure sets: 14 дней;
- deploy-time `db:backup`: 10 последних dump-файлов.

Retention меняется через:

```text
RESTIC_KEEP_DAILY
RESTIC_KEEP_WEEKLY
RESTIC_KEEP_MONTHLY
BACKUP_LOCAL_KEEP_DAYS
DB_DEPLOY_BACKUP_KEEP
```

Weekly job запускает `restic forget --prune --group-by host` с AND-фильтром
`--tag planner,kind:infrastructure`. Timestamp-каталоги и уникальные backup-id
tags не создают отдельные retention groups. Перед изменением политики можно
запустить `BACKUP_PRUNE_DRY_RUN=1 npm run backup:prune`: Restic покажет выборку
без удаления, локальные наборы также сохраняются. Временный полностью
изолированный тест политики: `node scripts/restic-retention-smoke.mjs`
(нужен Restic в PATH; опционально `RESTIC_BIN`). Offsite storage желательно
защитить bucket versioning/object lock и отдельными credentials без доступа к
удалению вне backup prefix.

## Первичное включение

Prerequisites на VPS:

- PostgreSQL client tools версии не старее production server;
- Restic;
- offsite object storage вне failure domain production VPS;
- alert endpoint, принимающий JSON POST, Telegram bot token и chat ID либо
  SMTP с `BACKUP_ALERT_EMAIL_TO`;
- изолированный PostgreSQL cluster/environment для drill.

1. Создать `/etc/planner/backup.env` по
   `deploy/backup.env.example`, обязательно задать `BACKUP_DATABASE_URL` для
   Timeweb login `planner_backup` только с привилегией `SELECT`, выставить owner
   `root:root` и mode `0600`. Migration `000096` добавляет отдельную RLS policy,
   запрещает backup login выполнение app-функций, а deploy сравнивает строки
   каждой таблицы с owner connection на одном PostgreSQL snapshot.
2. Создать `/etc/planner/restic-password`; deploy назначит owner
   `root:planner-backup` и mode `0640`, чтобы пароль мог прочитать только
   backup-user.
3. Инициализировать repository один раз: `restic init`.
4. В `/etc/planner/planner.env` настроить persistent
   `API_ICON_ASSET_DIR=/var/lib/planner/icon-assets`,
   `USER_BACKUP_RESTORE_DATABASE_URL`, `USER_BACKUP_RESTORE_HELPER_URL`,
   `USER_BACKUP_RESTORE_HELPER_SECRET`, `BACKUP_AUTOMATION_ENABLED=1` и
   `RESTORE_DRILL_AUTOMATION_ENABLED=1`.
5. Выполнить обычный `npm run deploy:prod`. Deploy проверит конфигурацию,
   подключение и права restore role, запустит `backup:database:check` для
   read-only backup login, установит units и включит timers.
6. Запустить первый backup и drill вручную.

Не загружайте secrets в git и не передавайте connection strings аргументами
диагностических команд, которые могут попасть в shell history.
Репозиторные backup/drill команды удаляют пароль из argv PostgreSQL tools и
передают его через временный `PGPASSFILE` с mode `0600`; файл удаляется после
завершения команды, в том числе при ошибке.

## Операционная проверка

```bash
sudo systemctl list-timers \
  planner-backup.timer \
  planner-backup-prune.timer \
  planner-restore-drill.timer

sudo systemctl start planner-backup.service
sudo journalctl -u planner-backup.service -n 200 --no-pager

sudo systemctl start planner-restore-drill.service
sudo journalctl -u planner-restore-drill.service -n 200 --no-pager

sudo -u planner jq . /opt/planner/shared/state/backup-status.json
sudo -u planner jq . /opt/planner/shared/state/restore-drill-status.json
```

Проверка Restic выполняется с environment из `/etc/planner/backup.env`:

```bash
restic snapshots --tag planner,kind:infrastructure
restic check
```

Успешный backup status должен содержать `status=success`, `offsite=true`,
`backupId` и `completedAt`. Успешный drill report содержит `status=success`,
backup ID, duration, counts migrations/users/workspaces, число asset references
и ноль invalid constraints.

`restic check` рекомендуется выполнять в отдельном maintenance job не реже
ежемесячного drill. Для большого repository допустим read-data subset согласно
возможностям установленной версии Restic.

## Как работает drill

Drill никогда не должен указывать на production database cluster.

1. Последний tagged snapshot восстанавливается из Restic во временный каталог.
2. Manifest, dump и все ассеты проверяются по checksum.
3. Создается одноразовая база с безопасным случайным именем.
4. Выполняется `pg_restore --exit-on-error --single-transaction`.
5. Migration runner доводит схему вперед до текущей версии.
6. Проверяются migrations, users, workspaces, invalid constraints и наличие
   каждого asset, на который ссылается восстановленная DB.
7. Одноразовая база, временные роли и файлы удаляются. Все cleanup-шаги
   выполняются даже при ошибке одного из них.
8. Успешный report записывается атомарно только после полного cleanup. Ошибка
   удаления записывает `failed`, завершает unit ненулевым кодом и запускает
   `OnFailure` alert.

`RESTORE_DRILL_ADMIN_DATABASE_URL` должен вести в отдельный recovery cluster,
где job имеет право создавать и удалять базы.

## Реакция на failure alert

1. Открыть journal упавшего unit.
2. Проверить status JSON и timestamp последнего успешного backup/drill.
3. Проверить доступность PostgreSQL, asset directory и offsite repository.
4. Не запускать prune, пока причина повреждения или отсутствия snapshot не
   установлена.
5. После исправления вручную перезапустить failed service.
6. Подтвердить новый offsite snapshot и успешный drill.
7. Если фактический RPO превышен, зарегистрировать incident.

Failure webhook или email является сигналом доставки, но не доказательством
работы alerting. После настройки нужно провести отдельный тестовый failure и
проверить получение события дежурным каналом.

## Аварийное восстановление

Ниже базовый сценарий восстановления в новую базу. Не восстанавливайте поверх
единственной production DB.

1. Зафиксировать incident time и запретить deploy/write operations.
2. Остановить API и maintenance worker:

```bash
sudo systemctl stop \
  planner-api \
  planner-user-backup-restore \
  planner-task-reminders
```

3. Сохранить текущее поврежденное состояние отдельно, если оно читается.
4. Выбрать snapshot по времени и backup ID через `restic snapshots`.
5. Восстановить выбранный snapshot в закрытый staging directory:

```bash
restic restore <snapshot-id> --target /srv/planner-recovery
npm run backup:verify -- /srv/planner-recovery/<path-to-backup-set>
```

6. Создать новую пустую target DB и восстановить dump:

```bash
createdb --maintenance-db "$RECOVERY_ADMIN_DATABASE_URL" "$RECOVERY_DB_NAME"
pg_restore \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  --dbname "$RECOVERY_DATABASE_URL" \
  /srv/planner-recovery/<path-to-backup-set>/postgres.dump

MIGRATE_DATABASE_URL="$RECOVERY_DATABASE_URL" npm run db:migrate
```

7. Проверить новую DB через `db:security:check`, smoke и read-only domain counts.
8. Восстановить ассеты сначала в staging directory, проверить ownership и
   inventory, затем синхронизировать при остановленном API:

```bash
sudo rsync -a --delete \
  /srv/planner-recovery/<path-to-backup-set>/assets/ \
  /var/lib/planner/icon-assets/
sudo chown -R root:planner-assets /var/lib/planner/icon-assets
sudo find /var/lib/planner/icon-assets -type d -exec chmod 2770 {} +
sudo find /var/lib/planner/icon-assets -type f -exec chmod 0660 {} +
```

9. Обновить production DB URLs на новую DB. Отдельно обновить runtime,
   maintenance и user-backup restore URLs.
10. Запустить API, проверить `/api/ready`, authenticated smoke, profile avatars,
    emoji assets и основные пользовательские экраны.
11. Открыть writes, запустить worker и наблюдать metrics/logs.
12. Не удалять поврежденную DB и recovery files до завершения postmortem.

При частичном повреждении asset storage DB и assets все равно восстанавливаются
из одного backup set, чтобы не получить ссылки на файлы из другого момента
времени.

## Очистка неиспользуемых ассетов

`npm run assets:gc` по умолчанию выполняет только dry-run. Задайте
`API_ICON_ASSET_DIR`, `INFRASTRUCTURE_BACKUP_DIR` и maintenance `DATABASE_URL`
с полным чтением ссылок (owner/BYPASSRLS). Runtime login отклоняется: неполный
RLS-результат нельзя использовать для удаления файлов.

Утилита проверяет все завершённые локальные backup sets, их checksum и dump,
требует хотя бы одну успешную копию и отказывается работать при `.incomplete-*`.
Она сохраняет файлы, упомянутые в БД или действующих локальных backup, включая
soft-deleted иконки. У старых manifest без списка ссылок сохраняется весь inventory.
В кандидаты попадают только обычные файлы старше семи дней; symlink запрещён.
Повторно проверяются inode, размер и mtime перед удалением.

`npm run assets:gc -- --apply` предназначен для отдельного окна обслуживания.
Предварительно остановите API, restore helper, reminder worker, backup/prune/drill
services и их timers. Утилита сама службы не останавливает: проверяет их состояние
через systemd и отсутствие других DB connections до и после построения плана.
Во время обслуживания не запускайте deployment, ручные загрузки или другие
подключения. После проверки результата возобновите службы и timers.

Не запускайте `--apply` как периодический online job. Файлы после неопределённого
результата commit сохраняются намеренно; dry-run показывает кандидатов для
последующей проверяемой уборки. Отдельная offsite копия уже содержит собственные
байты ассетов и не зависит от наличия файла в рабочем storage.

## Acceptance checklist

- три timer активны и имеют следующее время запуска;
- manual backup завершился с `offsite=true`;
- Restic snapshot виден с ожидаемыми tags;
- checksum verify проходит;
- failure alert доставлен;
- monthly drill восстанавливает именно offsite snapshot;
- drill report содержит ноль invalid constraints и все asset references;
- drill получает `success` только после удаления временной DB, ролей и файлов;
- принудительная ошибка `dropdb` или удаления роли дает `failed`, ненулевой exit
  code и failure alert;
- фактические RPO/RTO записываются после каждого drill;
- доступ к bucket и recovery cluster проверяется отдельно от production VPS.

#!/usr/bin/env bash
#
# Ночной бэкап продовой базы crm: pg_dump → проверка → Timeweb S3 → чистка старых.
#
# Запускается с хоста по cron под root. Конфиг — /root/.crm-backup-env
# (см. docs/ops-backups.md). Ни pg_dump, ни aws-cli на хост не ставятся:
# первый берётся из контейнера БД, второй из одноразового amazon/aws-cli.
#
# ── Чему этот скрипт научен на чужом опыте ──────────────────────────────────
#
# На этой же машине лежит woord-backup.sh, который 116 ночей подряд падал с
# «No such container» — контейнер, в который он ходил, давно удалён. Скрипт при
# этом вёл себя корректно: set -e, честный ненулевой код возврата. Не сработало
# другое — про его падения никто не узнал, потому что cron писал вывод в файл и
# сам ничего не отправлял. Поэтому здесь:
#
#   * любое падение шлёт письмо с хвостом лога (trap на ERR и EXIT);
#   * успех отмечается в heartbeat-файле, а отдельный сторож
#     (prod-backup-watchdog.sh) ругается, если бэкапа не было двое суток —
#     молчание не должно быть неотличимо от порядка;
#   * дамп проверяется до отправки: pg_restore --list должен его прочитать,
#     а размер — быть не смешным;
#   * рядом кладётся .meta с числом строк ключевых таблиц, чтобы
#     prod-backup-verify.sh мог доказать, что восстановленная копия
#     действительно содержит данные, а не просто открывается.

set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# shellcheck disable=SC1091
set -a; source /root/.crm-backup-env; set +a

: "${POSTGRES_CONTAINER:?нужен POSTGRES_CONTAINER}"
: "${BACKUP_BUCKET:?нужен BACKUP_BUCKET}"
: "${BACKUP_PREFIX:?нужен BACKUP_PREFIX}"
: "${AWS_ENDPOINT_URL:?нужен AWS_ENDPOINT_URL}"
: "${AWS_ACCESS_KEY_ID:?нужен AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?нужен AWS_SECRET_ACCESS_KEY}"

RETENTION="${BACKUP_RETENTION_DAYS:-30}"
MIN_DUMP_BYTES="${BACKUP_MIN_BYTES:-200000}"
HEARTBEAT="${BACKUP_HEARTBEAT_FILE:-/var/lib/crm-backup/last-success}"
STATE_DIR="$(dirname "$HEARTBEAT")"

# Таблицы, по которым считаем строки в .meta. Не «все» — нужен дешёвый и
# устойчивый признак, что в дампе лежат данные, а не пустая схема.
COUNT_TABLES="${BACKUP_COUNT_TABLES:-documents document_items ingredients kb_pages user_venue_roles profiles venues}"

DATE=$(date -u +%Y-%m-%dT%H%M%SZ)
WORKDIR=$(mktemp -d /tmp/crm-backup.XXXXXX)
DUMP="${WORKDIR}/crm-${DATE}.dump"
ROLES="${WORKDIR}/crm-${DATE}.roles.sql"
META="${WORKDIR}/crm-${DATE}.meta"
LOG="${WORKDIR}/run.log"

log() { echo "[$(date -u -Iseconds)] $*" | tee -a "$LOG"; }

# ── Письмо ──────────────────────────────────────────────────────────────────
# Тема кодируется в base64 по RFC 2047: без этого кириллица в Subject приедет
# кракозябрами.
send_mail() {
  local subject="$1" body="$2"
  [ -n "${BACKUP_ALERT_EMAIL:-}" ] || return 0
  [ -n "${SMTP_HOST:-}" ] || return 0
  local encoded="=?UTF-8?B?$(printf '%s' "$subject" | base64 -w0)?="
  {
    printf 'From: %s <%s>\n' "${SMTP_SENDER_NAME:-Sheerly}" "$SMTP_ADMIN_EMAIL"
    printf 'To: %s\n' "$BACKUP_ALERT_EMAIL"
    printf 'Subject: %s\n' "$encoded"
    printf 'Content-Type: text/plain; charset=UTF-8\n\n'
    printf '%s\n' "$body"
  } | curl -sS --url "smtps://${SMTP_HOST}:${SMTP_PORT:-465}" --ssl-reqd \
        --mail-from "$SMTP_ADMIN_EMAIL" --mail-rcpt "$BACKUP_ALERT_EMAIL" \
        --user "${SMTP_USER}:${SMTP_PASS}" --upload-file - \
    || echo "[$(date -u -Iseconds)] не удалось отправить письмо" >> "$LOG"
}

SNAP_HOLDER=""
FAILED=1
finish() {
  local code=$?
  # Сессия со снимком не должна пережить скрипт: открытая транзакция
  # repeatable read держит vacuum.
  if [ -n "$SNAP_HOLDER" ]; then
    exec 9>&- 2>/dev/null || true
    kill "$SNAP_HOLDER" 2>/dev/null || true
  fi
  docker exec "$POSTGRES_CONTAINER" sh -c "rm -f /tmp/crm-snap-*.txt" 2>/dev/null || true
  if [ "$FAILED" = "1" ]; then
    send_mail "CRM: бэкап базы НЕ СДЕЛАН" \
"Ночной бэкап продовой базы завершился с ошибкой (код ${code}).

Хвост лога:
$(tail -25 "$LOG" 2>/dev/null || echo '(лога нет)')

Сервер: $(hostname), $(date -u -Iseconds)
Скрипт: $0"
  fi
  rm -rf "$WORKDIR"
}
trap finish EXIT

# Две обёртки, а не одна с "$@": docker-аргументы обязаны стоять до имени
# образа, а aws-аргументы — после. Смешаешь — docker примет "s3" за образ.
aws_cli() {
  docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
    amazon/aws-cli:latest --endpoint-url "$AWS_ENDPOINT_URL" "$@"
}

aws_cli_with_file() {
  local mount="$1"; shift
  docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -v "$mount" \
    amazon/aws-cli:latest --endpoint-url "$AWS_ENDPOINT_URL" "$@"
}

log "старт, контейнер ${POSTGRES_CONTAINER}"

# ── 1. Снимок, из которого берётся и дамп, и счётчики ───────────────────────
#
# Счётчики строк обязаны считаться из ТОГО ЖЕ снимка, что и дамп. Иначе на живой
# базе любая запись между дампом и подсчётом сделает .meta несогласованным, и
# еженедельная проверка объявит здоровый бэкап испорченным. Ложная тревога здесь
# опаснее молчания: на неё перестают смотреть, а следом перестают смотреть и на
# настоящую.
#
# Держим одну psql-сессию, кормим её через FIFO и не закрываем до конца работы.
# Транзакция repeatable read внутри неё и есть тот снимок: pg_dump получает его
# через --snapshot, а счётчики считаются позже в этой же транзакции, то есть по
# определению по тем же данным.
#
# Вывод забираем через `\o файл` с последующим сбросом `\o`: psql пишет в файл
# блоками, и без закрытия файла строка со снимком просто зависла бы в буфере.
SNAP_ID_FILE="/tmp/crm-snap-id-$$.txt"
COUNTS_FILE="/tmp/crm-snap-counts-$$.txt"
FIFO="${WORKDIR}/snap.fifo"
mkfifo "$FIFO"

docker exec -i "$POSTGRES_CONTAINER" psql -U supabase_admin -d postgres -X -q -A -t \
  < "$FIFO" > /dev/null 2>&1 &
SNAP_HOLDER=$!
exec 9>"$FIFO"

printf 'begin isolation level repeatable read;\n\\o %s\nselect pg_export_snapshot();\n\\o\n' \
  "$SNAP_ID_FILE" >&9

SNAPSHOT_ID=""
for _ in $(seq 1 100); do
  # `|| true` обязателен: пока psql не создал файл, cat возвращает ненулевой
  # код, а под set -e с pipefail это роняет присваивание вместе со скриптом —
  # ровно на первой же итерации ожидания.
  SNAPSHOT_ID=$(docker exec "$POSTGRES_CONTAINER" sh -c "cat ${SNAP_ID_FILE} 2>/dev/null" | tr -d '[:space:]' || true)
  [ -n "$SNAPSHOT_ID" ] && break
  sleep 0.2
done
if [ -z "$SNAPSHOT_ID" ]; then
  log "ОШИБКА: не удалось экспортировать снимок"
  exit 1
fi
log "снимок ${SNAPSHOT_ID}"

# ── 2. Дамп ─────────────────────────────────────────────────────────────────
#
# Права и владельцев НЕ вырезаем (никаких --no-owner/--no-privileges): без
# GRANT'ов для anon/authenticated восстановленная база отдаёт PostgREST
# «permission denied for table» ещё до того, как дело дойдёт до RLS — грабли из
# миграции 047. Роли живут на уровне кластера и в pg_dump не попадают, поэтому
# сохраняем их отдельным дампом.
docker exec "$POSTGRES_CONTAINER" \
  pg_dump -U supabase_admin --format=custom --compress=9 --snapshot="$SNAPSHOT_ID" postgres > "$DUMP"
log "дамп готов: $(stat -c%s "$DUMP") байт"

docker exec "$POSTGRES_CONTAINER" pg_dumpall -U supabase_admin --roles-only > "$ROLES"
log "роли: $(stat -c%s "$ROLES") байт"

# ── 3. Проверка до отправки ─────────────────────────────────────────────────
SIZE=$(stat -c%s "$DUMP")
if [ "$SIZE" -lt "$MIN_DUMP_BYTES" ]; then
  log "ОШИБКА: дамп подозрительно мал (${SIZE} < ${MIN_DUMP_BYTES})"
  exit 1
fi

ENTRIES=$(docker run --rm -v "${DUMP}:/d.dump:ro" "$(docker inspect -f '{{.Config.Image}}' "$POSTGRES_CONTAINER")" \
  pg_restore --list /d.dump | grep -c ';' || true)
if [ "${ENTRIES:-0}" -lt 100 ]; then
  log "ОШИБКА: pg_restore --list вернул ${ENTRIES} записей — дамп не читается"
  exit 1
fi
log "дамп читается, записей в оглавлении: ${ENTRIES}"

# ── 4. Метаданные: сколько строк было в том же снимке ───────────────────────
#
# Считаем в уже открытой транзакции — по тем же данным, что попали в дамп.
# Если хоть один счётчик не посчитался, бэкап падает целиком: раньше сюда
# писался «?», проверка такие строки пропускала, и при отказе всех счётчиков
# она отчиталась бы об успехе, не сравнив ни одной таблицы.
# `\o` открываем ОДИН раз на все запросы: каждый вызов `\o файл` обрезает файл,
# поэтому при перенаправлении внутри цикла выживал бы только последний счётчик.
printf '\\o %s\n' "$COUNTS_FILE" >&9
for t in $COUNT_TABLES; do
  printf "select 'rows.%s='||count(*) from public.%s;\n" "$t" "$t" >&9
done
printf '\\o\ncommit;\n\\q\n' >&9
exec 9>&-
wait "$SNAP_HOLDER" 2>/dev/null || true
SNAP_HOLDER=""

COUNTS=$(docker exec "$POSTGRES_CONTAINER" sh -c "cat ${COUNTS_FILE} 2>/dev/null" | grep '^rows\.' || true)
# То же самое: без || выше пустой результат уронил бы скрипт.
EXPECTED_COUNT=$(echo "$COUNT_TABLES" | wc -w)
GOT_COUNT=$(printf '%s\n' "$COUNTS" | grep -c '^rows\.' || true)
if [ "${GOT_COUNT:-0}" -ne "$EXPECTED_COUNT" ]; then
  log "ОШИБКА: счётчиков ${GOT_COUNT} вместо ${EXPECTED_COUNT} — метаданные неполные"
  exit 1
fi

{
  echo "date=${DATE}"
  echo "size=${SIZE}"
  echo "sha256=$(sha256sum "$DUMP" | cut -d' ' -f1)"
  echo "snapshot=${SNAPSHOT_ID}"
  printf '%s\n' "$COUNTS"
} > "$META"
log "метаданные: ${GOT_COUNT} счётчиков из снимка"

# ── 5. Отправка ─────────────────────────────────────────────────────────────
for f in "$DUMP" "$ROLES" "$META"; do
  name=$(basename "$f")
  aws_cli_with_file "${f}:/upload:ro" s3 cp /upload "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${name}" --only-show-errors
  log "загружено: ${BACKUP_PREFIX}/${name}"
done

# Сверяем размер объекта в хранилище с локальным: «загрузилось без ошибки» и
# «доехало целиком» — разные утверждения.
REMOTE_SIZE=$(aws_cli s3api head-object --bucket "$BACKUP_BUCKET" \
  --key "${BACKUP_PREFIX}/$(basename "$DUMP")" --query ContentLength --output text)
if [ "$REMOTE_SIZE" != "$SIZE" ]; then
  log "ОШИБКА: в хранилище ${REMOTE_SIZE} байт вместо ${SIZE}"
  exit 1
fi
log "размер в хранилище совпал: ${REMOTE_SIZE}"

# ── 6. Чистка старых ────────────────────────────────────────────────────────
#
# Строго внутри своего префикса. В том же бакете лежат бэкапы соседнего
# проекта, и удалять их — не наше дело.
CUTOFF=$(date -u -d "${RETENTION} days ago" +%Y-%m-%d)
log "удаляю объекты ${BACKUP_PREFIX}/ старше ${CUTOFF}"
aws_cli s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "${BACKUP_PREFIX}/" \
  --query "Contents[?LastModified<'${CUTOFF}T00:00:00.000Z'].Key" --output text 2>/dev/null \
| tr '\t' '\n' \
| while read -r key; do
    [ -z "$key" ] && continue
    [ "$key" = "None" ] && continue
    case "$key" in "${BACKUP_PREFIX}/"*) ;; *) log "пропускаю чужой ключ ${key}"; continue;; esac
    log "  rm ${key}"
    aws_cli s3 rm "s3://${BACKUP_BUCKET}/${key}" --only-show-errors
  done

# ── 7. Heartbeat ────────────────────────────────────────────────────────────
mkdir -p "$STATE_DIR"
date -u -Iseconds > "$HEARTBEAT"
log "готово"

FAILED=0

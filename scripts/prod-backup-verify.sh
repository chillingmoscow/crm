#!/usr/bin/env bash
#
# Еженедельная проверка бэкапа восстановлением.
#
# Берёт свежий дамп из S3, поднимает одноразовый Postgres того же образа, что и
# прод, разворачивает в него дамп и сверяет число строк с .meta, записанным в
# момент снятия.
#
# Смысл именно в сверке. «Файл лежит в хранилище» и «файл открывается» — ещё не
# бэкап; бэкап — это когда из файла поднимается база с теми же данными. Пока
# это не проверено, восстановление остаётся предположением, а проверять его в
# день аварии поздно.
#
# Прод не трогается вообще: всё происходит в отдельном контейнере, который
# удаляется в конце в любом случае.

set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# shellcheck disable=SC1091
set -a; source /root/.crm-backup-env; set +a

: "${POSTGRES_CONTAINER:?нужен POSTGRES_CONTAINER}"
: "${BACKUP_BUCKET:?нужен BACKUP_BUCKET}"
: "${BACKUP_PREFIX:?нужен BACKUP_PREFIX}"
: "${AWS_ENDPOINT_URL:?нужен AWS_ENDPOINT_URL}"

WORKDIR=$(mktemp -d /tmp/crm-verify.XXXXXX)
CHECK_CONTAINER="crm-restore-check-$$"
LOG="${WORKDIR}/run.log"
IMAGE=$(docker inspect -f '{{.Config.Image}}' "$POSTGRES_CONTAINER")

log() { echo "[$(date -u -Iseconds)] $*" | tee -a "$LOG"; }

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
        --user "${SMTP_USER}:${SMTP_PASS}" --upload-file - || true
}

FAILED=1
finish() {
  local code=$?
  docker rm -f "$CHECK_CONTAINER" >/dev/null 2>&1 || true
  if [ "$FAILED" = "1" ]; then
    send_mail "CRM: бэкап НЕ ВОССТАНАВЛИВАЕТСЯ" \
"Еженедельная проверка бэкапа восстановлением провалилась (код ${code}).
Это значит, что файлы в хранилище есть, но поднять из них базу не удалось.

Хвост лога:
$(tail -30 "$LOG" 2>/dev/null || echo '(лога нет)')

Сервер: $(hostname), $(date -u -Iseconds)"
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

# ── 1. Какой дамп самый свежий ──────────────────────────────────────────────
LATEST=$(aws_cli s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "${BACKUP_PREFIX}/" \
  --query "reverse(sort_by(Contents[?ends_with(Key, '.dump')], &LastModified))[0].Key" --output text)
if [ -z "$LATEST" ] || [ "$LATEST" = "None" ]; then
  log "ОШИБКА: в ${BACKUP_PREFIX}/ нет ни одного дампа"
  exit 1
fi
BASE="${LATEST%.dump}"
log "проверяю ${LATEST}"

aws_cli_with_file "${WORKDIR}:/out" s3 cp "s3://${BACKUP_BUCKET}/${LATEST}"        /out/dump      --only-show-errors
aws_cli_with_file "${WORKDIR}:/out" s3 cp "s3://${BACKUP_BUCKET}/${BASE}.meta"      /out/meta      --only-show-errors
aws_cli_with_file "${WORKDIR}:/out" s3 cp "s3://${BACKUP_BUCKET}/${BASE}.roles.sql" /out/roles.sql --only-show-errors

# ── 2. Целостность файла ────────────────────────────────────────────────────
EXPECTED_SHA=$(grep '^sha256=' "${WORKDIR}/meta" | cut -d= -f2)
ACTUAL_SHA=$(sha256sum "${WORKDIR}/dump" | cut -d' ' -f1)
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  log "ОШИБКА: sha256 не совпал (ожидали ${EXPECTED_SHA}, получили ${ACTUAL_SHA})"
  exit 1
fi
log "sha256 совпал"

# ── 3. Одноразовая база того же образа, что и прод ──────────────────────────
docker run -d --name "$CHECK_CONTAINER" -e POSTGRES_PASSWORD="verify-$$" "$IMAGE" >/dev/null
log "поднял ${CHECK_CONTAINER} из ${IMAGE}"

# Ждём УСТОЙЧИВОЙ готовности, а не первого «готов». Образ Supabase во время
# инициализации поднимает временный сервер, прогоняет init-скрипты и
# перезапускается. Первый же pg_isready отвечает утвердительно именно на этот
# временный сервер — и восстановление обрывается на середине с «server closed
# the connection». Поэтому требуем пять успешных ответов подряд.
STABLE=0
for _ in $(seq 1 90); do
  if docker exec "$CHECK_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    STABLE=$((STABLE + 1))
    [ "$STABLE" -ge 5 ] && break
  else
    STABLE=0
  fi
  sleep 2
done
if [ "$STABLE" -lt 5 ]; then
  log "ОШИБКА: проверочная база так и не поднялась"
  exit 1
fi
log "проверочная база готова"

# ── 4. Восстановление ───────────────────────────────────────────────────────
#
# Разворачиваем в СВЕЖУЮ базу, которую создаёт сам postgres, и с
# --no-owner --no-privileges. Причина не в лени:
#
#   * в образе Supabase роль `postgres` не суперпользователь, а владельцы в
#     дампе — `supabase_admin`, поэтому ALTER ... OWNER TO падает с
#     «must be member of role»;
#   * зайти под `supabase_admin` в одноразовом контейнере нельзя — у него не
#     задан пароль, а сменить его без суперпользователя невозможно;
#   * если разворачивать в существующую базу `postgres`, все CREATE SCHEMA
#     упираются в «уже существует» и до таблиц дело не доходит вовсе.
#
# Отсюда граница этой проверки, о которой стоит помнить: она доказывает, что
# ДАННЫЕ восстанавливаются целиком, но не проверяет владельцев и GRANT'ы. В
# самом дампе они есть (pg_dump снимается без --no-owner/--no-privileges) —
# просто разложить их можно только в нормально поднятый стек Supabase, а не в
# песочницу. Порядок настоящего восстановления описан в docs/ops-backups.md.
#
# roles.sql в проверке не разворачивается по той же причине (нужен
# суперпользователь), но в хранилище кладётся: при реальном восстановлении он
# нужен первым.
docker cp "${WORKDIR}/dump" "${CHECK_CONTAINER}:/tmp/crm.dump"
docker exec "$CHECK_CONTAINER" createdb -U postgres verify

set +e
docker exec "$CHECK_CONTAINER" pg_restore -U postgres -d verify \
  --no-owner --no-privileges --no-comments /tmp/crm.dump > "${WORKDIR}/restore.log" 2>&1
RESTORE_CODE=$?
set -e
RESTORE_ERRORS=$(grep -c '^pg_restore: error' "${WORKDIR}/restore.log" || true)
log "pg_restore завершился с кодом ${RESTORE_CODE}, строк с ошибками: ${RESTORE_ERRORS:-0}"

# Ожидаемый шум — объекты vault/pgsodium, которыми владеет сам образ Supabase, и
# попытка выставить log_min_messages без нужных прав. Всё остальное — повод
# провалить проверку: иначе провал восстановления функций, триггеров, политик
# или таблиц вне списка счётчиков прошёл бы незамеченным, а скрипт отчитался бы
# об успехе.
#
# `|| true` не для красоты: при чистом восстановлении grep не найдёт ничего и
# вернёт 1, а под set -e с pipefail это уронило бы проверку ровно в тот момент,
# когда всё прошло идеально.
EXPECTED_RE='permission denied for (table|sequence) (key|secrets|key_key_id_seq)|permission denied to set parameter "log_min_messages"|relation "decrypted_secrets" already exists'

grep '^pg_restore: error' "${WORKDIR}/restore.log" 2>/dev/null | sed -E 's/.*ERROR:  //' \
  | cut -c1-70 | sort -u | while read -r e; do log "  (ошибка восстановления) ${e}"; done || true

UNEXPECTED=$(grep '^pg_restore: error' "${WORKDIR}/restore.log" 2>/dev/null \
  | grep -Ev "$EXPECTED_RE" || true)
if [ -n "$UNEXPECTED" ]; then
  log "ОШИБКА: восстановление дало ошибки вне ожидаемого списка:"
  printf '%s\n' "$UNEXPECTED" | head -10 | while read -r e; do log "  ${e}"; done || true
  exit 1
fi

TABLES=$(docker exec "$CHECK_CONTAINER" psql -U postgres -d verify -X -q -t -A \
  -c "select count(*) from pg_tables where schemaname='public';")
log "таблиц в public: ${TABLES}"

# ── 5. Главная проверка: те же ли данные ────────────────────────────────────
MISMATCH=0
COMPARED=0
REPORT=""
while IFS= read -r line; do
  case "$line" in rows.*) ;; *) continue;; esac
  table="${line#rows.}"; table="${table%%=*}"
  expected="${line#*=}"
  # «?» в метаданных быть не должно: скрипт бэкапа падает, если счётчик не
  # посчитался. Если такое всё же приехало — это дефект, а не повод молча
  # пропустить таблицу.
  if [ "$expected" = "?" ]; then
    log "ОШИБКА: в метаданных нет числа строк для ${table}"
    exit 1
  fi
  COMPARED=$((COMPARED + 1))
  actual=$(docker exec "$CHECK_CONTAINER" psql -U postgres -d verify -X -q -t -A \
             -c "select count(*) from public.${table};" 2>/dev/null || echo "нет таблицы")
  if [ "$actual" != "$expected" ]; then
    MISMATCH=$((MISMATCH + 1))
    REPORT="${REPORT}
  РАСХОЖДЕНИЕ ${table}: в дампе ${expected}, восстановилось ${actual}"
    log "РАСХОЖДЕНИЕ ${table}: ожидали ${expected}, получили ${actual}"
  else
    REPORT="${REPORT}
  ${table}: ${actual}"
    log "${table}: ${actual} — совпало"
  fi
done < "${WORKDIR}/meta"

if [ "$COMPARED" -eq 0 ]; then
  log "ОШИБКА: в метаданных не оказалось ни одного счётчика — сравнивать нечего"
  exit 1
fi

if [ "$MISMATCH" -ne 0 ]; then
  log "ОШИБКА: расхождений ${MISMATCH}"
  exit 1
fi

log "проверка пройдена: восстановленная копия совпадает с дампом"
send_mail "CRM: бэкап проверен восстановлением" \
"Еженедельная проверка прошла успешно.

Дамп: ${LATEST}
Таблиц в public: ${TABLES}
Сверено таблиц: ${COMPARED}
Строк с ошибками при восстановлении: ${RESTORE_ERRORS:-0} — это объекты
vault/pgsodium, которыми владеет сам образ Supabase; к данным отношения не
имеют. Значимо совпадение строк ниже.

Таблицы:${REPORT}

Сервер: $(hostname), $(date -u -Iseconds)"

FAILED=0

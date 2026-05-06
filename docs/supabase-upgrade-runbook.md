# Supabase Upgrade Runbook (self-hosted via Coolify)

Operational guide for upgrading the CRM Supabase stack on production.
Compiled from the 2026-05-06 upgrade session (Apr/2025 versions → latest).

---

## Context

| Item | Value |
|---|---|
| Server | `185.178.44.60` (`ssh root@185.178.44.60`) |
| Coolify version | 4.0.0 (note: known volume-prefix bug, see below) |
| Coolify project | `my-first-project` |
| Service Coolify ID | `jk8o8os4wowowg088ksckcc4` |
| Compose path | `/data/coolify/services/jk8o8os4wowowg088ksckcc4/docker-compose.yml` |
| Public domain | `https://supabase.sheerly.app` |
| Postgres data volume (current) | `jk8o8os4wowowg088ksckcc4_jk8o8os4wowowg088ksckcc4-supabase-db-data` |
| Reference stack used in 2026-05 | Woord (`q24gc87hd6op291zogvgf5yr`) — also self-hosted on same server |

---

## Critical rules

### 1. Never edit compose via Coolify UI editor

Coolify 4.0.0 has a bug: each Save in the compose editor adds an extra project-name prefix to volume **mounts** but not to volume **declarations**. Result: docker-compose sees a "new" volume name on next deploy → creates an empty volume → Postgres initializes as fresh DB → "data lost" (actually orphaned on the previous-named volume).

After 1 paste/save: `..._supabase-db-data` becomes `..._jk8o8os4_supabase-db-data` in mounts.
After 2 paste/saves: triple prefix. Etc.

**Always edit the compose file directly on the server.**

### 2. Apply changes by direct file edit + docker compose CLI

```bash
ssh root@185.178.44.60
cd /data/coolify/services/jk8o8os4wowowg088ksckcc4
# edit docker-compose.yml with sed/python/vim
docker compose -p jk8o8os4wowowg088ksckcc4 up -d
```

Coolify won't override file edits unless someone clicks Deploy in UI (which re-renders from its DB and applies the prefix bug). Just opening the service page is fine — only the compose editor's Save+Deploy is dangerous.

### 3. Always pg_dumpall before starting

```bash
docker exec supabase-db-jk8o8os4wowowg088ksckcc4 pg_dumpall -U postgres \
  | gzip > /root/pre-upgrade-$(date +%Y%m%d-%H%M).sql.gz
```

CRM data is small (~22 MB postgres + ~150 MB analytics logs at time of writing), backup is fast.

### 4. Note current Postgres volume location for emergency recovery

```bash
docker inspect supabase-db-jk8o8os4wowowg088ksckcc4 \
  --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{println}}{{end}}'
```

---

## Pre-flight: get a current reference stack

This runbook's pattern is **diff against a working newer Supabase stack** to learn what the latest template looks like, then apply the deltas.

In May 2026 the Woord stack was 6+ months newer than the CRM stack — perfect reference. Next time, Woord may also be outdated. Three ways to get a fresh reference:

### Option A: Spin up a temporary Supabase service in Coolify

1. Coolify → New → Service → Supabase
2. Name it something like `temp-reference-NNN` in any project
3. Don't bother with env config — let Coolify generate the compose
4. Read `/data/coolify/services/<NEW_ID>/docker-compose.yml` for current image versions
5. Read `/data/coolify/services/<NEW_ID>/volumes/logs/vector.yml` for current Vector config
6. Read `/data/coolify/services/<NEW_ID>/volumes/api/kong-entrypoint.sh` (if present)
7. After upgrade is done, delete the temp service to free resources

This is the cleanest option — gets you the exact current Coolify template.

### Option B: Coolify GitHub repo

https://github.com/coollabsio/coolify/tree/main/templates/compose/supabase shows the current template. Image versions are pinned in the file.

### Option C: Upstream Supabase

https://github.com/supabase/supabase/tree/master/docker — original Supabase compose, useful to verify what versions Supabase themselves consider current. Coolify's template usually matches but with extra labels/wiring.

Once you have a reference, set:
```
REFERENCE_ID=<the-new-stack-id>      # e.g., q24gc87hd6op291zogvgf5yr
TARGET_ID=jk8o8os4wowowg088ksckcc4   # the CRM Supabase
```

---

## Upgrade workflow

For each service: bump image → docker compose up -d → check status & logs → handle errors → next service.

### Order (low-risk to high-risk)

| # | Service | Risk | Why |
|---|---|---|---|
| 1 | postgres | low | patch within same major (e.g. 15.8.x → 15.8.y) — no schema migration |
| 2 | studio | low | UI only, no DB writes |
| 3 | postgres-meta | low | reads `pg_catalog`, no schema |
| 4 | imgproxy | low | stateless image processor |
| 5 | edge-runtime | low | function executor, stateless |
| 6 | supavisor | low | connection pooler, no schema |
| 7 | storage-api | medium | minor `storage` schema migrations + likely needs ownership fix |
| 8 | logflare | medium | migrates `_supabase._analytics` schema |
| 9 | gotrue | medium-high | `auth` schema migrations + likely needs ownership fix + maybe oauth_* table reset |
| 10 | vector | high | requires synchronous `vector.yml` replacement (config syntax changes) |
| 11 | postgrest | medium | usually fine, may need pool size tuning |
| 12 | kong | high | namespace change `kong → kong/kong`, custom entrypoint script needed |
| 13 | realtime | high | large schema/Erlang-state migrations, usually self-managed if schema owner is correct |

Group 1-6 can be bumped together (the "careful Stage 1" approach). 7-13 should each be handled individually with verification.

### Bump command pattern

```bash
COMPOSE="/data/coolify/services/$TARGET_ID/docker-compose.yml"
sed -i "s|<old-image-tag>|<new-image-tag>|" "$COMPOSE"
cd /data/coolify/services/$TARGET_ID
docker compose -p $TARGET_ID up -d
```

### Verification after each bump

```bash
# Status (should be "healthy" or "Up X seconds" no restart loop)
docker ps --filter "name=$TARGET_ID" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"

# Logs (look for "fatal", "error", restart loops)
docker logs <container-name> --tail 30

# Data integrity check
docker exec supabase-db-$TARGET_ID psql -U postgres -c "
  SELECT 'kb_pages' AS t, COUNT(*) FROM public.kb_pages
  UNION ALL SELECT 'auth.users', COUNT(*) FROM auth.users;"

# External smoke test through gateway
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://supabase.sheerly.app/auth/v1/health
```

---

## Common breakages and how to fix

### Permission error: "must be owner of table/function X"

**Where seen**: gotrue (auth tables), storage (storage tables/functions).

**Cause**: Old Coolify Supabase template created tables owned by `postgres` user. Service connects as `supabase_auth_admin` / `supabase_storage_admin`. New service version's migration tries `ALTER TABLE` → permission denied.

**Fix — auth schema**:
```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='auth' AND tableowner='postgres'
  LOOP
    EXECUTE 'ALTER TABLE auth.' || quote_ident(r.tablename) || ' OWNER TO supabase_auth_admin';
  END LOOP;
END $$;
```

**Fix — storage schema** (also needs functions and sequences):
```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT 'TABLE ' AS kind, c.relname AS name FROM pg_class c
           JOIN pg_namespace n ON n.oid=c.relnamespace
           JOIN pg_roles ro ON ro.oid=c.relowner
           WHERE n.nspname='storage' AND ro.rolname='postgres' AND c.relkind='r'
           UNION ALL
           SELECT 'SEQUENCE ', c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid=c.relnamespace
           JOIN pg_roles ro ON ro.oid=c.relowner
           WHERE n.nspname='storage' AND ro.rolname='postgres' AND c.relkind='S'
           UNION ALL
           SELECT 'VIEW ', c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid=c.relnamespace
           JOIN pg_roles ro ON ro.oid=c.relowner
           WHERE n.nspname='storage' AND ro.rolname='postgres' AND c.relkind='v'
  LOOP
    EXECUTE 'ALTER ' || r.kind || ' storage.' || quote_ident(r.name) || ' OWNER TO supabase_storage_admin';
  END LOOP;
  FOR r IN SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           JOIN pg_roles ro ON ro.oid=p.proowner
           WHERE n.nspname='storage' AND ro.rolname='postgres'
  LOOP
    EXECUTE 'ALTER FUNCTION storage.' || quote_ident(r.name) || '(' || r.args || ') OWNER TO supabase_storage_admin';
  END LOOP;
END $$;
```

After applying, restart the failing service:
```bash
docker restart supabase-auth-$TARGET_ID         # or supabase-storage-$TARGET_ID
```

### Gotrue migration fails on auth.oauth_clients

**Symptom**: log shows `error executing migrations/2025xxxxxx_add_oauth_clients_table.up.sql, sql: ... ERROR: column "client_id" does not exist`.

**Cause**: Old gotrue created `auth.oauth_clients` with one schema; new gotrue's migration assumes a different starting structure (e.g. expects a `client_id text` column that didn't exist before).

**Diagnose**: check if oauth tables are empty:
```sql
SELECT 'oauth_clients' t, COUNT(*) FROM auth.oauth_clients
UNION ALL SELECT 'oauth_authorizations', COUNT(*) FROM auth.oauth_authorizations
UNION ALL SELECT 'oauth_client_states', COUNT(*) FROM auth.oauth_client_states
UNION ALL SELECT 'oauth_consents', COUNT(*) FROM auth.oauth_consents;
```

**Fix (if all empty)** — drop and let new gotrue recreate:
```sql
DROP TABLE IF EXISTS auth.oauth_consents CASCADE;
DROP TABLE IF EXISTS auth.oauth_authorizations CASCADE;
DROP TABLE IF EXISTS auth.oauth_client_states CASCADE;
DROP TABLE IF EXISTS auth.oauth_clients CASCADE;
DROP TYPE IF EXISTS auth.oauth_client_type CASCADE;
DROP TYPE IF EXISTS auth.oauth_registration_type CASCADE;
```

```bash
docker restart supabase-auth-$TARGET_ID
```

If oauth tables have data, manual schema migration is needed — consult Supabase release notes for the affected gotrue version.

### Vector won't start, config errors

**Symptom**: `supabase-vector` in restart loop. Logs show parse errors about unknown functions or fields.

**Cause**: Vector config syntax changes between minor versions (e.g. 0.28 → 0.53):
- `starts_with()` → `contains()`
- `to_timestamp!()` → `parse_timestamp!()`
- query-string auth `?api_key=` → header `x-api-key`
- new sections (filters, transforms) added

**Fix**: replace `vector.yml` from reference stack:
```bash
cp /data/coolify/services/$REFERENCE_ID/volumes/logs/vector.yml \
   /data/coolify/services/$TARGET_ID/volumes/logs/vector.yml
docker restart supabase-vector-$TARGET_ID
```

Verify these env vars exist in compose's vector service `environment:` block (newer versions need them):
- `LOGFLARE_API_KEY`
- `LOGFLARE_PUBLIC_ACCESS_TOKEN`
- `LOGFLARE_PRIVATE_ACCESS_TOKEN`
- `SERVICE_PASSWORD_LOGFLARE`

If any are missing, add them. Coolify env editor sets them as `${SERVICE_PASSWORD_LOGFLARE}` references.

### Kong: "Permission denied" on /home/kong/kong.yml

**Cause**: Old template's entrypoint `bash -c 'eval ... > ~/kong.yml && ...'` worked under root in `kong:2.8.1`. The newer `kong/kong:3.9.1+` runs as non-root user → can't write to `/home/kong/`.

**Fix** — use a separate entrypoint script writing to `/usr/local/kong/kong.yml`:

1. Copy entrypoint from reference:
```bash
cp /data/coolify/services/$REFERENCE_ID/volumes/api/kong-entrypoint.sh \
   /data/coolify/services/$TARGET_ID/volumes/api/kong-entrypoint.sh
chmod +x /data/coolify/services/$TARGET_ID/volumes/api/kong-entrypoint.sh
```

2. Patch compose. The nested quoting in the old entrypoint defeats `sed`, use Python via stdin:

```bash
cat <<'PYEOF' | ssh root@185.178.44.60 'python3 -'
path = "/data/coolify/services/jk8o8os4wowowg088ksckcc4/docker-compose.yml"
with open(path) as f: content = f.read()

old_entry = "    entrypoint: 'bash -c ''eval \"echo \\\"$$(cat ~/temp.yml)\\\"\" > ~/kong.yml && /docker-entrypoint.sh kong docker-start'''"
new_entry = "    entrypoint: /home/kong/kong-entrypoint.sh"
assert old_entry in content
content = content.replace(old_entry, new_entry, 1)

old_vol = "      - '/data/coolify/services/jk8o8os4wowowg088ksckcc4/volumes/api/kong.yml:/home/kong/temp.yml'"
new_vol = ("      - '/data/coolify/services/jk8o8os4wowowg088ksckcc4/volumes/api/kong-entrypoint.sh:/home/kong/kong-entrypoint.sh'\n"
           "      - '/data/coolify/services/jk8o8os4wowowg088ksckcc4/volumes/api/kong.yml:/home/kong/temp.yml'")
assert old_vol in content
content = content.replace(old_vol, new_vol, 1)

content = content.replace("KONG_DECLARATIVE_CONFIG: /home/kong/kong.yml",
                          "KONG_DECLARATIVE_CONFIG: /usr/local/kong/kong.yml", 1)
with open(path, "w") as f: f.write(content)
print("patched")
PYEOF
```

3. Apply: `cd /data/coolify/services/$TARGET_ID && docker compose -p $TARGET_ID up -d`

### PostgREST: PGRST003 timeouts

**Symptom**: postgrest container `Up`, but logs flood with `{"code":"PGRST003","message":"Timed out acquiring connection from connection pool."}`. Frontend gets HTTP 504 on writes.

**Cause**: Default pool size = 10. CRM frontend autosave (e.g. kb_threads metadata updates) bursts can exceed it. Newer PostgREST versions enforce 5-sec acquire timeout.

**Fix** — bump pool size:
```bash
sed -i "/PGRST_DB_URI:/a\\      PGRST_DB_POOL: 30" /data/coolify/services/$TARGET_ID/docker-compose.yml
docker compose -p $TARGET_ID up -d
```

Verify in logs after restart:
```
Connection Pool initialized with a maximum size of 30 connections
```

### Volume name mismatch (data appears lost after deploy)

**Symptom**: Postgres container is healthy, but `SELECT count(*) FROM public.kb_pages` returns "relation does not exist" or zero rows in known-populated tables.

**Diagnose** — list all volumes for the stack and their sizes:
```bash
for v in $(docker volume ls -q | grep -E "$TARGET_ID.*supabase-db-data"); do
  path=$(docker volume inspect "$v" --format '{{.Mountpoint}}')
  size=$(du -sh "$path" 2>/dev/null | cut -f1)
  printf "%-95s %s\n" "$v" "$size"
done
```

You'll see one or more volumes with sizes ranging from ~4 KB (empty) to 200+ MB (real data). The largest one is your data; the currently-mounted one (per `docker inspect`) may be the small empty one.

**Fix** — copy data from the populated volume to the currently-mounted volume:
```bash
# Stop everything to release locks
docker stop $(docker ps --filter "name=$TARGET_ID" -q)

# Identify volume paths
OLD_DATA="/var/lib/docker/volumes/<largest-volume-name>/_data"
NEW_DATA=$(docker inspect supabase-db-$TARGET_ID \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}')

# Wipe target, copy from source preserving permissions
find "$NEW_DATA" -mindepth 1 -delete
cp -a "$OLD_DATA"/. "$NEW_DATA"/

# Same for the -config volume (smaller, ~100 KB)
OLD_CFG="/var/lib/docker/volumes/<config-volume>/_data"
NEW_CFG=$(docker inspect supabase-db-$TARGET_ID \
  --format '{{range .Mounts}}{{if eq .Destination "/etc/postgresql-custom"}}{{.Source}}{{end}}{{end}}')
find "$NEW_CFG" -mindepth 1 -delete
cp -a "$OLD_CFG"/. "$NEW_CFG"/

# Start postgres first, verify, then everything else
docker start supabase-db-$TARGET_ID
docker exec supabase-db-$TARGET_ID psql -U postgres -c "SELECT COUNT(*) FROM public.kb_pages;"
docker start $(docker ps -a --filter "name=$TARGET_ID" -q --filter "status=exited")
```

This trick can be repeated as many times as needed — the source volume isn't moved, only copied from. Older volumes can be left in place as backup until disk pressure forces cleanup.

---

## Cheat sheet

```bash
# === Connect ===
ssh root@185.178.44.60
cd /data/coolify/services/jk8o8os4wowowg088ksckcc4

# === Inspect stack ===
docker ps --filter "name=jk8o8os4" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"

# === Apply compose changes ===
docker compose -p jk8o8os4wowowg088ksckcc4 up -d

# === Logs ===
docker logs <container-name> --tail 30
docker logs <container-name> --since 1m | tail -50

# === Postgres shell ===
docker exec -it supabase-db-jk8o8os4wowowg088ksckcc4 psql -U postgres
docker exec -it supabase-db-jk8o8os4wowowg088ksckcc4 psql -U postgres -d _supabase

# === Data integrity check ===
docker exec supabase-db-jk8o8os4wowowg088ksckcc4 psql -U postgres -c "
  SELECT 'kb_pages' AS t, COUNT(*) FROM public.kb_pages
  UNION ALL SELECT 'kb_threads', COUNT(*) FROM public.kb_threads
  UNION ALL SELECT 'auth.users', COUNT(*) FROM auth.users
  UNION ALL SELECT 'transactions', COUNT(*) FROM public.transactions;"

# === Full backup ===
docker exec supabase-db-jk8o8os4wowowg088ksckcc4 pg_dumpall -U postgres \
  | gzip > /root/pre-upgrade-$(date +%Y%m%d-%H%M).sql.gz

# === Volume audit ===
docker volume ls | grep jk8o8os4
docker inspect supabase-db-jk8o8os4wowowg088ksckcc4 \
  --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{println}}{{end}}'

# === Smoke tests via gateway ===
curl -sI https://supabase.sheerly.app/auth/v1/health
curl -sI https://supabase.sheerly.app/rest/v1/

# === Logflare manual cleanup (fallback if cron isn't running) ===
/usr/local/bin/cleanup-logflare.sh
```

---

## What worked vs what didn't

### Worked
- Direct edit `/data/coolify/services/<ID>/docker-compose.yml` + `docker compose up -d` — bypasses Coolify UI bug
- Bumping low-risk images en bloc (postgres patch, studio, postgres-meta, imgproxy, edge-runtime, supavisor)
- Owner change for `auth.*` and `storage.*` schemas to fix migration permission errors
- Dropping empty `auth.oauth_*` tables to let new gotrue recreate with correct schema
- Copying `vector.yml` and `kong-entrypoint.sh` from a working reference stack
- Increasing `PGRST_DB_POOL` from 10 → 30 to handle frontend autosave bursts
- Python via SSH stdin for compose edits with complex nested quoting

### Didn't work, don't repeat
- Pasting full compose into Coolify UI editor — adds prefix to volumes, breaks data linkage on next Deploy
- Bumping `vector` image without replacing `vector.yml` — config syntax breaks
- Bumping `kong` image without replacing entrypoint — non-root permission denied on `/home/kong/`
- `DROP` without `CASCADE` on `auth.oauth_clients` — has FKs from `oauth_authorizations`/`oauth_consents`
- Multi-layer `sed` with nested single quotes via SSH — quoting always mangles, use python instead
- Trying to fix volume drift via "fix the compose" — Coolify keeps re-prefixing, so just copy data into whatever volume is currently mounted

---

## When this runbook is shown to Claude

Paste the contents of this file into chat at the start of a Supabase upgrade session. Then say something like:

> Here's our Supabase upgrade runbook from last time. We're starting another upgrade. Verify the server state, identify a current reference stack, and let's go through the order. Last time the reference was Woord — check if it's still current or if we need to spin up a temporary one.

Claude can then:
1. SSH and inspect current image versions
2. Find or create a fresh reference stack
3. Plan the upgrade order
4. Walk through each service with the documented patterns

---

## Backups taken in 2026-05-06 session (kept on server)

- `/root/crm-supabase-pre-upgrade-20260506-0415.sql.gz` — full pg_dumpall before any changes (1.3 MB)
- `/data/coolify/services/jk8o8os4wowowg088ksckcc4/docker-compose.yml.bak-*` — compose snapshots
- `/data/coolify/services/jk8o8os4wowowg088ksckcc4/volumes/logs/vector.yml.bak-*` — original vector config

These can be deleted after a few weeks of stable operation.

---

## Final image versions after 2026-05-06 upgrade

| Service | Version |
|---|---|
| postgres | `15.8.1.085` |
| studio | `2026.03.16-sha-5528817` |
| logflare | `1.31.2` |
| vector | `0.53.0-alpine` |
| postgrest | `v14.6` |
| gotrue | `v2.186.0` |
| storage-api | `v1.44.2` |
| imgproxy | `v3.30.1` |
| postgres-meta | `v0.95.2` |
| edge-runtime | `v1.71.2` |
| supavisor | `2.7.4` |
| kong | `kong/kong:3.9.1` |
| realtime | `v2.76.5` |
| supabase-minio | `RELEASE.2025-10-15T17-29-55Z` |

// Read-only verification of the two Quick Resto payroll sources.
// Uses the existing integration account; never prints credentials or source payloads.
import { loadEnvFile } from "node:process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";
loadEnvFile(".env.local");
const date = process.argv[2] ?? "2026-10-12";
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Use YYYY-MM-DD");
const dir = await mkdtemp(join(tmpdir(), "sheerly-payroll-probe-"));
try {
  const files = {
    client: "src/lib/integrations/quickresto/client.ts",
    "request-queue": "src/lib/integrations/quickresto/request-queue.ts",
    crypto: "src/lib/integrations/crypto.ts",
    auth: "src/lib/integrations/quickresto/auth-state.ts",
  };
  for (const [name, file] of Object.entries(files)) {
    const code = ts.transpileModule(await readFile(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText.replaceAll("./request-queue.ts", "./request-queue.mjs");
    await writeFile(join(dir, `${name}.mjs`), code);
  }
  const mod = async (name) =>
    import(pathToFileURL(join(dir, `${name}.mjs`)).href);
  const { callQuickRestoBackOfficeData, loginQuickRestoBackOffice } =
    await mod("client");
  const { decryptSecret } = await mod("crypto");
  const {
    parseStoredBackOfficeAuth,
    isBackOfficeAuthFresh,
    isBackOfficeAuthError,
  } = await mod("auth");
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: settings, error: settingsError } = await db
    .from("sales_settings")
    .select("account_id,venue_id,quickresto_venue_id,timezone,day_start_hour")
    .eq("enabled", true)
    .single();
  if (settingsError) throw new Error("Local active sales settings unavailable");
  const { data: c, error } = await db
    .from("integration_connections")
    .select("*")
    .eq("account_id", settings.account_id)
    .eq("provider", "quickresto")
    .single();
  if (error || !c) throw new Error("Quick Resto connection unavailable");
  const secret = (prefix) =>
    decryptSecret({
      encrypted: c[`${prefix}_encrypted`],
      iv: c[`${prefix}_iv`],
      tag: c[`${prefix}_tag`],
    });
  let session = c.backoffice_cookie_encrypted
    ? parseStoredBackOfficeAuth(secret("backoffice_cookie"))
    : null;
  const login = async () =>
    loginQuickRestoBackOffice({
      layerName: c.login,
      baseUrl: c.backoffice_base_url,
      login: c.backoffice_login,
      password: secret("backoffice_password"),
    });
  if (!session || !isBackOfficeAuthFresh(session)) session = await login();
  // CHILLING currently uses Europe/Moscow (UTC+3), 09:00 business-day boundary.
  if (settings.timezone !== "Europe/Moscow")
    throw new Error(
      "Probe only supports the verified CHILLING Moscow timezone",
    );
  const start = Date.parse(
      `${date}T${String(settings.day_start_hour).padStart(2, "0")}:00:00+03:00`,
    ),
    end = start + 86400000;
  const results = [];
  for (const [kind, path, field] of [
    ["attendance", "personnel.salary.workshift/select", "startTime"],
    ["cashbox", "front.encashment/select", "timeEncashment"],
  ]) {
    const query = {
      start: 0,
      count: 150,
      "filterField[]": [field, field],
      "filterOperator[]": ["range", "range"],
      "filterValue[]": [start, end - 1],
      timeZone: -180,
      businessDayOffsetInMs: settings.day_start_hour * 3600000,
    };
    const read = () =>
      callQuickRestoBackOfficeData({
        layerName: c.login,
        baseUrl: c.backoffice_base_url,
        authorization: session.authorization,
        path,
        query,
      });
    try {
      let response;
      try {
        response = await read();
      } catch (e) {
        if (!isBackOfficeAuthError(e)) throw e;
        session = await login();
        response = await read();
      }
      const rows = (response.ds ?? [])
        .filter((r) => r.type === "item")
        .map((r) => r.object)
        .filter(
          (r) =>
            !r.deleted &&
            (!settings.quickresto_venue_id ||
              String(r.tableScheme?.id) ===
                String(settings.quickresto_venue_id)),
        );
      results.push({
        kind,
        accessible: true,
        rows: rows.length,
        fields: Object.keys(rows[0] ?? {}).sort(),
        sourceVenueIds: [...new Set(rows.map((r) => r.tableScheme?.id))],
        ...(kind === "attendance"
          ? {
              uniqueEmployees: new Set(rows.map((r) => r.owner?.id)).size,
              employees: [...new Map(rows.map((r) => [r.owner?.id, {
                id: r.owner?.id,
                name: r.owner?.title ?? null,
              }])).values()],
              intervals: rows.map((r) => ({
                id: r.id,
                start: new Date(r.startTime).toISOString(),
                end: r.endTime ? new Date(r.endTime).toISOString() : null,
              })),
              open: rows.filter((r) => !r.endTime).length,
            }
          : {
              tips: rows
                .filter(
                  (r) =>
                    r.typeTransaction === "cashOut" &&
                    /^чаевые$/iu.test((r.comment ?? "").trim()),
                )
                .map((r) => ({
                  id: r.id,
                  amount: r.amount,
                  time: r.timeEncashment,
                })),
            }),
      });
    } catch (e) {
      results.push({
        kind,
        accessible: false,
        reason: /403/.test(e.message)
          ? "integration_account_permission_denied_403"
          : /401/.test(e.message)
            ? "integration_account_unauthorized_401"
            : "source_read_failed",
      });
      process.exitCode = 1;
    }
  }
  console.log(
    JSON.stringify(
      { date, venueId: settings.quickresto_venue_id, results },
      null,
      2,
    ),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

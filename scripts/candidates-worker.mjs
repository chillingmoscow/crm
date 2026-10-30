import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const origin = process.env.CANDIDATES_WORKER_ORIGIN ?? "http://localhost:3001";
if (!process.env.CRON_SECRET) throw new Error("Настройте CRON_SECRET");
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log("Обработчик анкет запущен");
while (!stopping) {
  try {
    const r = await fetch(new URL("/api/cron/candidates", origin), {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET },
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) console.error(`Анкеты: HTTP ${r.status}`);
  } catch (e) {
    console.error(`Анкеты: ${e.cause?.code ?? e.name}`);
  }
  if (!stopping) await new Promise((r) => setTimeout(r, 15000));
}

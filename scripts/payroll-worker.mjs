// Independent runner: no open browser is needed to complete queued shifts.
import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const origin = process.env.PAYROLL_WORKER_ORIGIN ?? "http://localhost:3400";
if (!process.env.CRON_SECRET)
  throw new Error("Настройте CRON_SECRET в .env.local");
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log(`Обработчик зарплаты запущен: ${origin}`);
while (!stopping) {
  let delay = 15000;
  try {
    const r = await fetch(new URL("/api/cron/payroll", origin), {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET },
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) console.error(`Обработчик зарплаты: HTTP ${r.status}`);
    else {
      const stats = await r.json();
      if (stats.processed && !stats.errors) delay = 500;
      if (stats.automationComparisons || stats.automationErrors)
        console.log(
          `Автоматизации: сверок ${stats.automationComparisons ?? 0}, ошибок ${stats.automationErrors ?? 0}`,
        );
      if (stats.processed)
        console.log(
          `Зарплата: обработано дней ${stats.processed}, ошибок ${stats.errors}`,
        );
    }
  } catch (e) {
    console.error(`Обработчик зарплаты: ${e.cause?.code ?? e.name}`);
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, delay));
}

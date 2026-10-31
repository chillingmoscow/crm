// Independent runner: no open browser is needed to complete queued shifts.
import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const origin = process.env.SALES_WORKER_ORIGIN ?? "http://localhost:3400";
if (!process.env.CRON_SECRET)
  throw new Error("Настройте CRON_SECRET в .env.local");
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log(`Обработчик смен запущен: ${origin}`);
while (!stopping) {
  let delay = 15000;
  try {
    const r = await fetch(new URL("/api/cron/sales-shifts", origin), {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET },
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) console.error(`Обработчик смен: HTTP ${r.status}`);
    else {
      const stats = await r.json();
      if (
        (stats.slices && !stats.failed) ||
        (stats.monthReports && !stats.monthReportErrors) ||
        (stats.additionalReports && !stats.additionalErrors) ||
        (stats.stockSlices && !stats.stockErrors)
      )
        delay = 500;
      if (stats.slices || stats.queued)
        console.log(
          `Смены: поставлено ${stats.queued}, обработано частей ${stats.slices}, ошибок ${stats.failed}`,
        );
      if (stats.monthReports || stats.monthReportErrors)
        console.log(
          `Месячные отчёты: обработано ${stats.monthReports}, ошибок ${stats.monthReportErrors}`,
        );
      if (stats.additionalReports || stats.additionalErrors)
        console.log(
          `Допродажи: обработано ${stats.additionalReports}, ошибок ${stats.additionalErrors}`,
        );
      if (stats.stockSlices || stats.stockErrors)
        console.log(
          `Списания: обработано частей ${stats.stockSlices}, ошибок ${stats.stockErrors}`,
        );
    }
  } catch (e) {
    console.error(`Обработчик смен: ${e.cause?.code ?? e.name}`);
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, delay));
}

// Local read-only reconciliation. Detailed HR data stays in the temporary folder.
import { loadEnvFile } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
loadEnvFile(".env.local");
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  )
)
  throw new Error("Local database only");
const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  ),
  source = JSON.parse(
    await readFile("/tmp/sheerly-payroll-source.json", "utf8"),
  );
const check = async (q) => {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const employees = await check(
    db.from("payroll_employees").select("id,name,role_name,quickresto_id"),
  ),
  accruals = await check(
    db
      .from("payroll_accruals")
      .select("*")
      .gte("business_date", "2026-09-01")
      .lt("business_date", "2026-10-01"),
  );
const date = (n) =>
  new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
const old = source.salary
  .slice(1)
  .filter((r) => r[0] && date(r[0]).startsWith("2026-09"));
const comparisons = employees
  .map((e) => {
    const previous = old.filter((r) => r[7] === e.name),
      current = accruals.filter(
        (a) =>
          a.employee_id === e.id &&
          a.calculation_snapshot.kind !== "monthly" &&
          a.calculation_snapshot.kind !== "adjustment",
      );
    return {
      employeeId: e.id,
      name: e.name,
      qrId: e.quickresto_id,
      previousShifts: previous.length,
      currentShifts: current.length,
      previousSalary: previous.reduce((s, r) => s + Number(r[14] || 0), 0),
      currentSalary: current.reduce(
        (s, a) =>
          s +
          a.components
            .filter(
              (c) =>
                ![
                  "tips",
                  "bonus",
                  "deduction",
                  "inventory",
                  "correction",
                ].includes(c.kind),
            )
            .reduce((s, c) => s + Number(c.amount || 0), 0),
        0,
      ),
      previousTips: previous.reduce((s, r) => s + Number(r[12] || 0), 0),
      currentTips: current.reduce((s, a) => s + Number(a.tips), 0),
    };
  })
  .filter((e) => e.previousShifts || e.currentShifts);
const details = old.map((r) => {
  const e = employees.find((e) => e.name === r[7]),
    a = accruals.find(
      (a) => a.employee_id === e?.id && a.business_date === date(r[0]),
    );
  return {
    date: date(r[0]),
    employeeId: e?.id,
    name: r[7],
    previousSalary: Number(r[14]),
    currentSalary:
      a?.components
        .filter(
          (c) =>
            !["tips", "bonus", "deduction", "inventory", "correction"].includes(
              c.kind,
            ),
        )
        .reduce((s, c) => s + Number(c.amount || 0), 0) ?? null,
    previousTips: Number(r[12]),
    currentTips: a?.tips ?? null,
    previousBase: r[9],
    previousPercent: r[10],
    previousExtra: r[11],
    components: a?.components,
  };
});
await writeFile(
  "/tmp/sheerly-payroll-comparison.json",
  JSON.stringify({ comparisons, details }, null, 2),
);
console.log(
  JSON.stringify(
    {
      previousDayRows: old.length,
      actualDayRows: accruals.filter(
        (a) => !["monthly", "adjustment"].includes(a.calculation_snapshot.kind),
      ).length,
      equalDailySalary: details.filter(
        (d) => d.previousSalary === d.currentSalary,
      ).length,
      missingActualEmployees: comparisons
        .filter((e) => e.previousShifts && !e.currentShifts)
        .map((e) => ({
          name: e.name,
          qrId: e.qrId,
          previousShifts: e.previousShifts,
        })),
      detailsFile: "/tmp/sheerly-payroll-comparison.json",
    },
    null,
    2,
  ),
);

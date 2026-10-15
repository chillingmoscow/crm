"use client";
import { useState } from "react";
import type { PayrollData } from "@/lib/payroll/types";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { loadPayroll } from "../actions";
import { LegacyPayments } from "./legacy-payments";

export function PayrollInitialData({ venueId }: { venueId: string }) {
  const [data, setData] = useState<PayrollData | null>(null);
  const [month, setMonth] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const reload = async () => {
    setLoading(true);
    try {
      const next = await loadPayroll();
      if (next.venueId !== venueId)
        throw new Error("Выберите это заведение в переключателе");
      if (!next.permissions.includes("payroll.view"))
        throw new Error("Для сверки выплат нужен доступ к зарплате команды");
      setData(next);
      setMonth(
        (previous) => previous || next.settings?.starts_on || "2026-09-01",
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить выплаты");
    } finally {
      setLoading(false);
    }
  };
  return (
    <details
      className="rounded-xl border"
      onToggle={(event) => {
        if (event.currentTarget.open && !data && !loading) void reload();
      }}
    >
      <summary className="cursor-pointer p-4 text-sm font-medium">
        Первоначальные данные по зарплате
      </summary>
      <div className="space-y-4 border-t p-4">
        <p className="text-sm text-muted-foreground">
          Разовая сверка выплат, сделанных до начала работы в Sheerly. Выберите
          счёт и статью расхода, затем подтвердите записи. После этого они
          попадут в ведомость.
        </p>
        {error && <p className="text-sm text-muted-foreground">{error}</p>}
        {loading && (
          <p className="text-sm text-muted-foreground">Загружаем выплаты…</p>
        )}
        {data && month && (
          <>
            <DateRangeFilter
              monthOnly
              ariaLabel="Месяц прежних выплат"
              value={{ start: new Date(`${month}T12:00:00`), end: null }}
              presetLabel={null}
              onChange={(value) => {
                if (value.start)
                  setMonth(
                    `${value.start.getFullYear()}-${String(value.start.getMonth() + 1).padStart(2, "0")}-01`,
                  );
              }}
            />
            <LegacyPayments data={data} month={month} onChange={reload} />
            {!data.legacyPayments.some(
              (p) => p.month === month && p.state === "review",
            ) && (
              <p className="text-sm text-muted-foreground">
                За выбранный месяц нет выплат, требующих сверки.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

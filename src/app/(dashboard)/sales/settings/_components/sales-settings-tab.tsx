"use client";
import { unwrapAction } from "@/lib/actions/result";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProfileSection } from "@/components/shared/profile-section";
import { SettingsDrawer } from "./settings-drawer";
import {
  loadSalesConfiguration,
  recalculateSalesHistory,
} from "@/app/(dashboard)/sales/shifts/actions";
import { businessDate } from "@/lib/sales/time";
import type { SalesConfiguration } from "@/lib/sales/types";
import { timezoneLabel } from "@/lib/org/venue-labels";
import { formatDayMonth } from "@/lib/format/date";
import { countRu, pluralRu } from "@/lib/format/plural";
import { SettlementSettingsSection } from "./settlement-settings";
import { CashControlSettingsSection } from "./cash-control-settings";
import { CashMovementSettingsSection } from "./cash-movement-settings";
import { FinanceExecutionSettingsSection } from "./finance-execution-settings";

/** Число дней между датами `YYYY-MM-DD` включительно. */
function daysInclusive(from: string, to: string) {
  const ms = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86400000) + 1) : 0;
}

export function SalesSettingsTab({ initial }: { initial: SalesConfiguration }) {
  const [data, setData] = useState(initial);
  const today = businessDate(
    new Date(),
    data.timezone,
    data.settings?.day_start_hour ?? 9,
  );
  const [from, setFrom] = useState(initial.historyStart ?? today);
  const [to, setTo] = useState(today);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void loadSalesConfiguration(initial.venueId)
          .then(unwrapAction)
          .then(setData)
          .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [initial.venueId]);
  const days = from && to ? daysInclusive(from, to) : 0;
  const recalculate = async () => {
    setBusy(true);
    setRecalcError(null);
    try {
      const n = unwrapAction(await recalculateSalesHistory({
        venueId: data.venueId,
        from,
        to,
      }));
      toast.success(
        `На пересчёт ${pluralRu(n, "поставлен", "поставлено", "поставлено")} ${countRu(n, "день", "дня", "дней")}`,
      );
      setConfirming(false);
      setData(unwrapAction(await loadSalesConfiguration(data.venueId)));
    } catch (e) {
      setRecalcError(
        e instanceof Error ? e.message : "Не удалось запустить пересчёт",
      );
    } finally {
      setBusy(false);
    }
  };
  const dayStart = String(data.settings?.day_start_hour ?? 9).padStart(2, "0");
  return (
    <div className="flex flex-col gap-5">
      <ProfileSection
        title="Расчёт смен"
        description="Продажи, чаевые и расходы из Quick Resto."
        actions={
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Settings2 />
            Настроить
          </Button>
        }
      >
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[13px] text-muted-foreground">Подключение</dt>
            <dd className="mt-1">
              {data.connected ? "Quick Resto подключён" : "Не подключено"}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Автообновление</dt>
            <dd className="mt-1">
              {data.settings?.enabled ? "Каждые 15 минут" : "Выключено"}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Рабочий день</dt>
            <dd className="mt-1 tabular-nums">
              {dayStart}:00–{dayStart}:00
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Часовой пояс</dt>
            <dd className="mt-1">{timezoneLabel(data.timezone)}</dd>
          </div>
        </dl>
        {!data.connected && (
          <Button variant="link" className="self-start px-0" asChild>
            <Link href="/settings/integrations/quickresto">
              Подключить Quick Resto
            </Link>
          </Button>
        )}
        {data.pending > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 shrink-0 animate-spin" />В очереди{" "}
            {countRu(data.pending, "день", "дня", "дней")}. Сохранить новые
            правила можно после завершения.
          </p>
        )}
      </ProfileSection>
      <ProfileSection
        title="Пересчёт истории"
        description="Повторно загрузим чеки и отчёты за выбранный период и применим текущие правила. Ручные исправления сохранятся."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="history-from" label="С" required>
            {(control) => (
              <DatePicker
                id={control.id}
                value={from}
                toDate={new Date(`${to || today}T00:00:00`)}
                onChange={setFrom}
              />
            )}
          </Field>
          <Field id="history-to" label="По" required>
            {(control) => (
              <DatePicker
                id={control.id}
                value={to}
                fromDate={from ? new Date(`${from}T00:00:00`) : undefined}
                toDate={new Date(`${today}T00:00:00`)}
                onChange={setTo}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            До 366 дней за один запуск.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setRecalcError(null);
              setConfirming(true);
            }}
            disabled={
              busy ||
              data.pending > 0 ||
              !data.connected ||
              !data.settings ||
              !from ||
              !to
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Пересчитать
          </Button>
        </div>
      </ProfileSection>
      <SettlementSettingsSection venueId={data.venueId} />
      <CashControlSettingsSection venueId={data.venueId} />
      <CashMovementSettingsSection venueId={data.venueId} />
      <FinanceExecutionSettingsSection venueId={data.venueId} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Пересчитать историю за ${countRu(days, "день", "дня", "дней")}?`}
        description={`С ${formatDayMonth(from) ?? from} по ${formatDayMonth(to) ?? to}. Чеки и отчёты загрузятся заново, к ним применятся текущие правила. Ручные исправления сохранятся.`}
        confirmLabel={`Пересчитать ${countRu(days, "день", "дня", "дней")}`}
        pendingLabel="Запускаем…"
        busy={busy}
        error={recalcError}
        onConfirm={() => void recalculate()}
      />
      {open && (
        <SettingsDrawer
          data={data}
          open
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void loadSalesConfiguration(data.venueId)
              .then(unwrapAction)
              .then(setData)
              .catch((e) => toast.error(e.message));
          }}
        />
      )}
    </div>
  );
}


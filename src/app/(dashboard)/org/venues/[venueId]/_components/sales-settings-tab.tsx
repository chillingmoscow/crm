"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsDrawer } from "@/app/(dashboard)/sales/shifts/_components/settings-drawer";
import {
  loadSalesConfiguration,
  recalculateSalesHistory,
} from "@/app/(dashboard)/sales/shifts/actions";
import { businessDate } from "@/lib/sales/time";
import type { SalesConfiguration } from "@/lib/sales/types";
import { SettlementSettingsSection } from "./settlement-settings";
import { CashControlSettingsSection } from "./cash-control-settings";

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
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void loadSalesConfiguration(initial.venueId)
          .then(setData)
          .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [initial.venueId]);
  const recalculate = async () => {
    setBusy(true);
    try {
      const n = await recalculateSalesHistory({
        venueId: data.venueId,
        from,
        to,
      });
      toast.success(`На пересчёт поставлено дней: ${n}`);
      setData(await loadSalesConfiguration(data.venueId));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось запустить пересчёт",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-lg border p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-semibold">Расчёт смен</h2>
            <p className="text-sm text-muted-foreground">
              Продажи, чаевые и расходы из Quick Resto.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Settings2 className="mr-2 size-4" />
            Настроить
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Подключение</dt>
            <dd className="mt-1">
              {data.connected ? "Quick Resto подключён" : "Не подключено"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Автообновление</dt>
            <dd className="mt-1">
              {data.settings?.enabled ? "Каждые 15 минут" : "Выключено"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Рабочий день</dt>
            <dd className="mt-1">
              {String(data.settings?.day_start_hour ?? 9).padStart(2, "0")}:00–
              {String(data.settings?.day_start_hour ?? 9).padStart(2, "0")}:00
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Часовой пояс</dt>
            <dd className="mt-1">{data.timezone}</dd>
          </div>
        </dl>
        {!data.connected && (
          <Button variant="link" className="px-0" asChild>
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
            {data.pending} дней. Сохранить новые правила можно после завершения.
          </p>
        )}
      </section>
      <section className="rounded-lg border p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="font-semibold">Пересчёт истории</h2>
          <p className="text-sm text-muted-foreground">
            Повторно загрузим чеки и отчёты за выбранный период и применим
            текущие правила. Ручные исправления сохранятся.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="history-from">С</Label>
            <Input
              id="history-from"
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="history-to">По</Label>
            <Input
              id="history-to"
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            До 366 дней за один запуск.
          </p>
          <Button
            onClick={() => void recalculate()}
            disabled={
              busy ||
              data.pending > 0 ||
              !data.connected ||
              !data.settings ||
              !from ||
              !to
            }
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Пересчитать
          </Button>
        </div>
      </section>
      <SettlementSettingsSection venueId={data.venueId}/>
      <CashControlSettingsSection venueId={data.venueId}/>
      {open && (
        <SettingsDrawer
          data={data}
          open
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void loadSalesConfiguration(data.venueId)
              .then(setData)
              .catch((e) => toast.error(e.message));
          }}
        />
      )}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  effectiveMetrics,
  metricKeys,
  metricLabels,
  metricHints,
  type MetricKey,
  type Metrics,
  type SalesDay,
  type SalesEvent,
} from "@/lib/sales/types";
import { adjustSales, salesHistory } from "../actions";
import { money, dayLabel } from "@/lib/sales/format";

import { PayrollDayPanel } from "@/app/(dashboard)/people/payroll/_components/payroll-context";
import { DayDiscussionPanel } from "../../_components/day-discussion";
import { SettlementPanel } from "./settlement-panel";

export function DayDrawer({
  day,
  tab,
  canAdjust,
  open,
  onClose,
  onSaved,
}: {
  day: SalesDay;
  tab: string;
  canAdjust: boolean;
  open: boolean;
  onClose: () => void;
  onSaved: (d: SalesDay) => void;
}) {
  const original = effectiveMetrics(day);
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        metricKeys.map((k) => [
          k,
          original[k] === null ? "" : String(original[k]),
        ]),
      ) as Record<MetricKey, string>,
  );
  const [resets, setResets] = useState<MetricKey[]>([]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(day.note);
  const [activeTab, setActiveTab] = useState(tab);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SalesEvent[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const changes: Partial<Metrics> = {};
  for (const k of metricKeys) {
    if (resets.includes(k)) changes[k] = null;
    else if (values[k] !== (original[k] === null ? "" : String(original[k])))
      changes[k] =
        values[k].trim() === "" ? NaN : Number(values[k].replace(",", "."));
  }
  const dirty = !!Object.keys(changes).length || note !== day.note;
  const close = () => {
    if (saving) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  useEffect(() => {
    if (activeTab !== "history" || events) return;
    let live = true;
    salesHistory(day.id)
      .then((v) => {
        if (live) {
          setEvents(v);
          setHistoryError(null);
        }
      })
      .catch((e) => {
        if (live)
          setHistoryError(
            e instanceof Error ? e.message : "Не удалось загрузить историю",
          );
      });
    return () => {
      live = false;
    };
  }, [activeTab, day.id, events]);
  const save = async () => {
    setError(null);
    for (const [k, v] of Object.entries(changes)) {
      if (
        v !== null &&
        (!Number.isFinite(v) ||
          Math.abs(v) > 1e12 ||
          Math.round(v * 100) / 100 !== v ||
          (k === "checks" && (v < 0 || !Number.isInteger(v))))
      ) {
        setError(
          `Проверьте поле «${metricLabels[k as MetricKey]}». Суммы — до двух знаков после запятой; число чеков — целое.`,
        );
        return;
      }
    }
    if (reason.trim().length < 3) {
      setError("Укажите причину исправления (не менее 3 символов)");
      return;
    }
    setSaving(true);
    try {
      const updated = await adjustSales({
        id: day.id,
        version: day.version,
        changes,
        reason: reason.trim(),
        note,
      });
      toast.success("Исправления сохранены");
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };
  const reset = (k: MetricKey) => {
    setResets((r) => [...r.filter((x) => x !== k), k]);
    setValues((v) => ({
      ...v,
      [k]: day.calculated[k] == null ? "" : String(day.calculated[k]),
    }));
  };
  const time = (date: string) => new Date(date).toLocaleString("ru-RU");
  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(v) => {
          if (!v) close();
        }}
        title={dayLabel(day.business_date)}
        description="Показатели смены"
        footer={
          activeTab === "values" && canAdjust ? (
            <>
              <Button variant="outline" disabled={saving} onClick={close}>
                Отмена
              </Button>
              <Button disabled={!dirty || saving} onClick={() => void save()}>
                {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
                Сохранить
              </Button>
            </>
          ) : undefined
        }
      >
        {day.sync_error && (
          <p className="flex gap-2 rounded-md border border-destructive/25 p-3 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            {day.sync_error}. Показаны последние сохранённые значения.
          </p>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger className="px-2 text-[13px]" value="values">
              Показатели
            </TabsTrigger>
            <TabsTrigger className="px-2 text-[13px]" value="employees">
              Команда
            </TabsTrigger>
            <TabsTrigger className="px-2 text-[13px]" value="comments">
              Комментарии
            </TabsTrigger>
            <TabsTrigger className="px-2 text-[13px]" value="history">
              История
            </TabsTrigger>
          </TabsList>
          <TabsContent value="values" className="space-y-5 pt-3">
            <p className="text-xs text-muted-foreground">
              Все суммы в рублях. Исправления сохраняются отдельно и не теряются
              при обновлении. Бар и чаевые со сбором пересчитываются из
              составляющих, если для них нет отдельного исправления.
            </p>
            <div className="space-y-4">
              {metricKeys.map((k) => (
                <div key={k} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`metric-${k}`} title={metricHints[k]}>
                      {metricLabels[k]}
                    </Label>
                    {k in day.overrides && !resets.includes(k) && canAdjust && (
                      <button
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => reset(k)}
                      >
                        <RotateCcw className="size-3" />
                        Вернуть исходное
                      </button>
                    )}
                  </div>
                  <Input
                    id={`metric-${k}`}
                    inputMode={k === "checks" ? "numeric" : "decimal"}
                    value={values[k]}
                    readOnly={!canAdjust}
                    placeholder="Нет данных"
                    onChange={(e) => {
                      setResets((r) => r.filter((x) => x !== k));
                      setValues((v) => ({ ...v, [k]: e.target.value }));
                    }}
                    className="tabular-nums"
                  />
                  {(k in day.overrides || resets.includes(k)) && (
                    <p className="text-xs text-muted-foreground">
                      Исходное: {money(day.calculated[k] ?? null)}
                      {resets.includes(k)
                        ? " · Исправление будет отменено"
                        : " · Исправлено вручную"}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sales-note">Комментарий</Label>
              <Textarea
                id="sales-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                readOnly={!canAdjust}
                maxLength={5000}
                placeholder="Заметка о смене"
              />
            </div>
            {canAdjust && (
              <div className="space-y-1.5">
                <Label htmlFor="sales-reason">
                  Причина исправления{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="sales-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                  placeholder="Почему меняете показатели?"
                />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <SettlementPanel venueId={day.venue_id} date={day.business_date}/>
          </TabsContent>
          <TabsContent value="employees">
            <PayrollDayPanel date={day.business_date} />
          </TabsContent>
          <TabsContent value="comments" className="pt-4">
            <DayDiscussionPanel
              venueId={day.venue_id}
              date={day.business_date}
            />
          </TabsContent>
          <TabsContent value="history" className="pt-3 space-y-5">
            {historyError ? (
              <p role="alert" className="text-sm text-destructive">
                {historyError}
              </p>
            ) : events === null ? (
              <p className="text-sm text-muted-foreground">
                Загружаем историю…
              </p>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Изменений пока нет.
              </p>
            ) : (
              events.map((event) => (
                <div key={event.id} className="border-b pb-4 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">
                      {event.kind === "adjustment"
                        ? event.actor_name || "Пользователь"
                        : event.kind === "import"
                          ? "Первичная загрузка"
                          : "Обновление Quick Resto"}
                    </p>
                    <time className="text-xs text-muted-foreground whitespace-nowrap">
                      {time(event.created_at)}
                    </time>
                  </div>
                  {event.reason && (
                    <p className="mt-1 text-sm">{event.reason}</p>
                  )}
                  {event.kind === "adjustment" && (
                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {Object.entries(event.changes).map(([k, raw]) => {
                        const change = raw as {
                          before: unknown;
                          after: unknown;
                          reset?: boolean;
                        };
                        return (
                          <p key={k}>
                            {k === "note"
                              ? "Комментарий"
                              : (metricLabels[k as MetricKey] ?? k)}
                            :{" "}
                            {k === "note"
                              ? `${change.before || "—"} → ${change.after || "—"}`
                              : `${money(change.before as number | null)} → ${money(change.after as number | null)}`}
                            {change.reset ? " · Возвращено исходное" : ""}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </EditDrawer>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить изменения?</AlertDialogTitle>
            <AlertDialogDescription>
              Несохранённые исправления будут потеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Продолжить редактирование</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>
              Отменить изменения
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

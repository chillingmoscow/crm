"use client";
import { useState } from "react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { dayLabel, money } from "@/lib/sales/format";
import {
  defaultAdditionalRules,
  type AdditionalKind,
} from "@/lib/sales/additional";
import { saveAdditionalRules, type AdditionalData } from "./actions";
export function AdditionalRulesEditor({
  data,
  onClose,
  onSaved,
}: {
  data: AdditionalData;
  onClose: () => void;
  onSaved: (d: AdditionalData) => void;
}) {
  const [config, setConfig] = useState(() =>
    structuredClone(
      data.rules.find((r) => r.valid_from <= data.nextFrom)?.config ??
        defaultAdditionalRules,
    ),
  );
  const [from, setFrom] = useState(data.nextFrom),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<AdditionalKind>("bar");
  async function save() {
    setBusy(true);
    try {
      const next = await saveAdditionalRules({
        venueId: data.venueId,
        version: data.version,
        from,
        config,
        reason,
      });
      onSaved(next);
      toast.success("Новая версия правил сохранена");
      onClose();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось сохранить правила",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <EditDrawer
      open
      onOpenChange={(v) => !v && !busy && onClose()}
      title="Правила допродаж"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={busy || !from || reason.trim().length < 3}
            onClick={() => void save()}
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as AdditionalKind)}>
        <TabsList>
          <TabsTrigger value="bar">Бар</TabsTrigger>
          <TabsTrigger value="masters">Кальяны</TabsTrigger>
        </TabsList>
        {(["bar", "masters"] as const).map((kind) => (
          <TabsContent value={kind} key={kind} className="mt-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              {kind === "bar"
                ? "Прибавка за одну продажу, ₽"
                : "Баллы за одну продажу"}
            </p>
            <div className="divide-y">
              {config[kind].map((g, i) => (
                <div key={g.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`rate-${kind}-${g.id}`}>{g.label}</Label>
                    <Input
                      id={`rate-${kind}-${g.id}`}
                      className="w-24 text-right tabular-nums"
                      type="number"
                      min="0"
                      step="0.01"
                      value={Number.isFinite(g.rate) ? g.rate : ""}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          [kind]: c[kind].map((x, j) =>
                            j === i
                              ? { ...x, rate: e.target.valueAsNumber }
                              : x,
                          ),
                        }))
                      }
                    />
                  </div>
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      Категории Quick Resto
                    </summary>
                    <Textarea
                      className="mt-2 text-sm"
                      aria-label={`Категории: ${g.label}`}
                      value={g.branches.join("\n")}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          [kind]: c[kind].map((x, j) =>
                            j === i
                              ? { ...x, branches: e.target.value.split("\n") }
                              : x,
                          ),
                        }))
                      }
                    />
                  </details>
                </div>
              ))}
            </div>
            {kind === "masters" && (
              <section className="space-y-3 border-t pt-4">
                <h3 className="font-semibold">Прибавка за целый балл</h3>
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <span>От баллов</span>
                  <span>₽ за балл</span>
                </div>
                {config.tiers.map((t, i) => (
                  <div key={i} className="grid grid-cols-2 gap-3">
                    {(["from", "rate"] as const).map((key) => (
                      <Input
                        key={key}
                        aria-label={`${key === "from" ? "Порог баллов" : "Рублей за балл"} ${i + 1}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number.isFinite(t[key]) ? t[key] : ""}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            tiers: c.tiers.map((x, j) =>
                              j === i
                                ? { ...x, [key]: e.target.valueAsNumber }
                                : x,
                            ),
                          }))
                        }
                      />
                    ))}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Берётся ставка достигнутого порога. Дробная часть баллов не
                  оплачивается.
                </p>
              </section>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <div className="space-y-2 border-t pt-5">
        <Label htmlFor="additional-from">Действует с</Label>
        <DatePicker
          id="additional-from"
          value={from}
          onChange={setFrom}
          fromDate={new Date(data.nextFrom + "T00:00:00")}
          clearable={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="additional-reason">Причина изменения</Label>
        <Textarea
          id="additional-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Новые ставки применятся к будущим рабочим дням. Сохранённые начисления
        остаются в истории.
      </p>
      <details className="border-t pt-4 text-sm">
        <summary className="cursor-pointer font-medium">История правил</summary>
        <div className="mt-3 divide-y">
          {data.rules.map((r) => (
            <div key={r.id} className="py-3">
              <p className="font-medium">С {dayLabel(r.valid_from)}</p>
              <p className="mt-1 text-muted-foreground">{r.reason}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString("ru-RU", {
                  timeZone: data.timezone,
                })}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Ставки этой версии
                </summary>
                {r.config[tab].map((g) => (
                  <p key={g.id} className="mt-1 text-xs">
                    {g.label} · {money(g.rate)} {tab === "bar" ? "₽" : "б."}
                  </p>
                ))}
              </details>
            </div>
          ))}
        </div>
      </details>
    </EditDrawer>
  );
}

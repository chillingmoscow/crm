"use client";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  initialCashControlRules,
  type CashControlRules,
} from "@/lib/sales/cash-control";
import {
  loadCashConfiguration,
  saveCashConfiguration,
  type CashConfiguration,
} from "@/app/(dashboard)/sales/shifts/cash-control-actions";
import { money } from "@/lib/sales/format";
function Form({
  data,
  onClose,
  onSaved,
}: {
  data: CashConfiguration;
  onClose: () => void;
  onSaved: (d: CashConfiguration) => void;
}) {
  const previous = data.versions[0],
    initial = previous?.config ?? initialCashControlRules;
  const [rules, setRules] = useState<CashControlRules>(initial),
    [threshold, setThreshold] = useState(String(initial.thresholdCents / 100)),
    [interval, setIntervalMinutes] = useState(String(initial.intervalMinutes)),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (
        !/^\d+(?:[.,]\d{1,2})?$/.test(threshold.trim()) ||
        !/^\d+$/.test(interval.trim())
      )
        throw new Error("Проверьте порог и интервал проверки");
      const saved = await saveCashConfiguration({
        venueId: data.venueId,
        version: previous?.version ?? 0,
        config: {
          ...rules,
          thresholdCents: Math.round(Number(threshold.replace(",", ".")) * 100),
          intervalMinutes: Number(interval),
        },
        reason,
      });
      onSaved(saved);
      toast.success("Правила контроля кассы сохранены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правила");
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditDrawer
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title="Контроль кассы"
      description="Открытие и закрытие кассовых смен"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={busy || !reason.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Сохраняем…" : "Сохранить правила"}
          </Button>
        </>
      }
    >
      <fieldset
        disabled={busy || !data.canManage}
        className="min-w-0 space-y-6"
      >
        <div className="space-y-2">
          <Label htmlFor="cash-threshold">Порог расхождения, ₽</Label>
          <Input
            id="cash-threshold"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            0 — показывать любое ненулевое расхождение. Недостача и излишек
            сравниваются с одним порогом.
          </p>
        </div>
        {(
          [
            ["opening", "Проверять открытие"],
            ["closing", "Проверять закрытие"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <Label htmlFor={`cash-${key}`}>{label}</Label>
            <Switch
              id={`cash-${key}`}
              checked={rules[key]}
              onCheckedChange={(v) => setRules((r) => ({ ...r, [key]: v }))}
            />
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 border-t pt-5">
          <div>
            <Label htmlFor="cash-auto">Автоматическая проверка</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Текущий и предыдущий рабочий день.
            </p>
          </div>
          <Switch
            id="cash-auto"
            checked={rules.autoRead}
            onCheckedChange={(v) => setRules((r) => ({ ...r, autoRead: v }))}
          />
        </div>
        {rules.autoRead && (
          <div className="space-y-2">
            <Label htmlFor="cash-interval">Интервал проверки, минут</Label>
            <Input
              id="cash-interval"
              inputMode="numeric"
              value={interval}
              onChange={(e) => setIntervalMinutes(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              От 15 минут до суток.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="cash-reason">Основание изменения</Label>
          <Textarea
            id="cash-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            placeholder="Что изменили и почему"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </fieldset>
    </EditDrawer>
  );
}
export function CashControlSettingsSection({ venueId }: { venueId: string }) {
  const [data, setData] = useState<CashConfiguration | null>(null),
    [error, setError] = useState<string | null>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    loadCashConfiguration(venueId)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [venueId]);
  const current = data?.versions[0];
  return (
    <section className="space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Контроль кассы</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {current
              ? `Порог ${money(current.config.thresholdCents / 100)} ₽ · ${current.config.autoRead ? `каждые ${current.config.intervalMinutes} мин.` : "ручная проверка"}`
              : "Расхождения при открытии и закрытии смен"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!data?.canManage}
          onClick={() => setOpen(true)}
        >
          <Settings2 className="mr-2 size-4" />
          Настроить
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {current && (
        <details className="border-t pt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            История правил
          </summary>
          <ol className="mt-3 divide-y">
            {data.versions.map((v) => (
              <li key={v.id} className="space-y-1 py-3">
                <p>
                  Версия {v.version} · {v.actor_name}
                </p>
                <p className="text-muted-foreground">
                  {new Date(v.created_at).toLocaleString("ru-RU")} · {v.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  Порог {money(v.config.thresholdCents / 100)} ₽ · открытие{" "}
                  {v.config.opening ? "вкл." : "выкл."} · закрытие{" "}
                  {v.config.closing ? "вкл." : "выкл."} ·{" "}
                  {v.config.autoRead
                    ? `каждые ${v.config.intervalMinutes} мин.`
                    : "ручная проверка"}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
      {open && data && (
        <Form
          data={data}
          onClose={() => setOpen(false)}
          onSaved={(d) => {
            setData(d);
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}

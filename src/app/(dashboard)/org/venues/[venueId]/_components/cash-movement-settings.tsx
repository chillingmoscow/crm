"use client";
import { useEffect, useState } from "react";
import { Plus, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cashMovementDefaults,
  cashMovementRulesSchema,
  type CashMovementRules,
} from "@/lib/sales/cash-movements";
import {
  loadMovementConfiguration,
  saveMovementConfiguration,
  type MovementConfiguration,
} from "@/app/(dashboard)/sales/shifts/cash-movement-actions";
function Choice({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={name} className="w-full">
          <SelectValue placeholder="Выберите" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function Form({
  data,
  onClose,
  onSaved,
}: {
  data: MovementConfiguration;
  onClose: () => void;
  onSaved: (d: MovementConfiguration) => void;
}) {
  const previous = data.versions[0],
    [rules, setRules] = useState<CashMovementRules>(
      previous?.config ?? {
        ...cashMovementDefaults,
        overrides: data.preset,
        cashAccountId: "",
        safeAccountId: "",
        operatingAccountId: "",
        incomeCategoryId: "",
        taxiCategoryId: "",
        tipsCategoryId: "",
      },
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CashMovementRules>(
    k: K,
    v: CashMovementRules[K],
  ) => setRules((r) => ({ ...r, [k]: v }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = cashMovementRulesSchema.safeParse(rules);
      if (!parsed.success)
        throw Error(parsed.error.issues[0]?.message ?? "Проверьте параметры");
      onSaved(
        await saveMovementConfiguration({
          venueId: data.venueId,
          version: previous?.version ?? 0,
          config: parsed.data,
          reason,
        }),
      );
      toast.success("Правила инкассаций сохранены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правила");
    } finally {
      setBusy(false);
    }
  };
  const patch = (
    index: number,
    change: Partial<CashMovementRules["overrides"][number]>,
  ) =>
    set(
      "overrides",
      rules.overrides.map((o, i) => (i === index ? { ...o, ...change } : o)),
    );
  return (
    <EditDrawer
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title="Инкассации и внесения"
      description="Счета, статьи и правила сверки"
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
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Счета</h3>
          {(
            [
              ["cashAccountId", "Касса"],
              ["safeAccountId", "Сейф"],
              ["operatingAccountId", "Операционный счёт"],
            ] as const
          ).map(([key, label]) => (
            <Choice
              key={key}
              name={`movement-${key}`}
              label={label}
              value={rules[key]}
              options={data.banks}
              onChange={(v) => set(key, v)}
            />
          ))}
        </div>
        <div className="space-y-4 border-t pt-5">
          <h3 className="text-sm font-semibold">Статьи</h3>
          {(
            [
              ["incomeCategoryId", "Внесения", "income"],
              ["taxiCategoryId", "Такси", "expense"],
              ["tipsCategoryId", "Чаевые", "expense"],
            ] as const
          ).map(([key, label, type]) => (
            <Choice
              key={key}
              name={`movement-${key}`}
              label={label}
              value={rules[key]}
              options={data.categories.filter((c) => c.type === type)}
              onChange={(v) => set(key, v)}
            />
          ))}
        </div>
        <div className="space-y-4 border-t pt-5">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="movement-auto">Автоматическая сверка</Label>
            <Switch
              id="movement-auto"
              checked={rules.autoRead}
              onCheckedChange={(v) => set("autoRead", v)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="movement-lookback">
                Повторно проверять, дней
              </Label>
              <Input
                id="movement-lookback"
                type="number"
                min={1}
                max={90}
                value={rules.lookbackDays}
                onChange={(e) => set("lookbackDays", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="movement-interval">Интервал, минут</Label>
              <Input
                id="movement-interval"
                type="number"
                min={15}
                max={1440}
                value={rules.intervalMinutes}
                onChange={(e) => set("intervalMinutes", Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Поздние выгрузки относятся к дате исходной кассовой смены.
          </p>
        </div>
        <details className="border-t pt-5 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Распознавание комментариев
          </summary>
          <div className="mt-4 space-y-4">
            {(
              [
                ["safePattern", "Инкассация в сейф"],
                ["taxiPattern", "Такси"],
                ["tipsPattern", "Чаевые"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`movement-${key}`}>{label}</Label>
                <Input
                  id={`movement-${key}`}
                  value={rules[key]}
                  maxLength={200}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </details>
        <details className="border-t pt-5 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Ручные решения · {rules.overrides.length}
          </summary>
          <div className="mt-4 space-y-4">
            {rules.overrides.map((o, i) => (
              <div key={i} className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Операция {o.sourceId ? `#${o.sourceId}` : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Убрать решение"
                    onClick={() =>
                      set(
                        "overrides",
                        rules.overrides.filter((_, index) => i !== index),
                      )
                    }
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`movement-id-${i}`}>
                      Номер Quick Resto
                    </Label>
                    <Input
                      id={`movement-id-${i}`}
                      inputMode="numeric"
                      value={o.sourceId || ""}
                      onChange={(e) =>
                        patch(i, { sourceId: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`movement-date-${i}`}>Дата смены</Label>
                    <DatePicker
                      id={`movement-date-${i}`}
                      value={o.date}
                      disabled={busy}
                      onChange={(date) => patch(i, { date })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`movement-amount-${i}`}>Сумма, ₽</Label>
                  <Input
                    id={`movement-amount-${i}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={o.amountCents ? o.amountCents / 100 : ""}
                    onChange={(e) =>
                      patch(i, {
                        amountCents: Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`movement-comment-${i}`}>
                    Исходный комментарий
                  </Label>
                  <Input
                    id={`movement-comment-${i}`}
                    value={o.comment}
                    onChange={(e) => patch(i, { comment: e.target.value })}
                  />
                </div>
                <Choice
                  name={`movement-route-${i}`}
                  label="Решение"
                  value={o.route}
                  options={[
                    { id: "hold", name: "Оставить на проверке" },
                    { id: "safe", name: "Перевод в сейф" },
                    { id: "operating", name: "Перевод на операционный счёт" },
                  ]}
                  onChange={(v) => patch(i, { route: v as typeof o.route })}
                />
                <div className="space-y-2">
                  <Label htmlFor={`movement-reason-${i}`}>
                    Основание решения
                  </Label>
                  <Textarea
                    id={`movement-reason-${i}`}
                    value={o.reason}
                    maxLength={1000}
                    onChange={(e) => patch(i, { reason: e.target.value })}
                  />
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                set("overrides", [
                  ...rules.overrides,
                  {
                    sourceId: 0,
                    date: "",
                    amountCents: 0,
                    comment: "",
                    route: "hold",
                    reason: "",
                  },
                ])
              }
            >
              <Plus className="mr-2 size-4" />
              Добавить решение
            </Button>
            <p className="text-xs text-muted-foreground">
              Решение действует только для указанной суммы, даты и комментария.
              Изменившаяся операция требует новой проверки.
            </p>
          </div>
        </details>
        <div className="space-y-2">
          <Label htmlFor="movement-reason">Основание изменения правил</Label>
          <Textarea
            id="movement-reason"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
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
export function CashMovementSettingsSection({ venueId }: { venueId: string }) {
  const [data, setData] = useState<MovementConfiguration | null>(null),
    [error, setError] = useState<string | null>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    loadMovementConfiguration(venueId)
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
  return (
    <section className="space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Инкассации и внесения</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Переводы из кассы, такси и выдача чаевых
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!data}
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
      {data && !data.versions.length && (
        <p className="text-xs text-muted-foreground">
          Счета и статьи пока не сопоставлены. Сверка не создаёт операций.
        </p>
      )}
      {!!data?.versions.length && (
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
                <p className="text-xs text-muted-foreground">
                  {new Date(v.created_at).toLocaleString("ru-RU")} · {v.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  Повторная сверка за {v.config.lookbackDays} дней ·{" "}
                  {v.config.autoRead
                    ? `каждые ${v.config.intervalMinutes} мин.`
                    : "вручную"}{" "}
                  · ручных решений {v.config.overrides.length}
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

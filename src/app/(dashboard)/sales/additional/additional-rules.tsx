"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AmountInput } from "@/components/finance/amount-input";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import { formatRub } from "@/components/shared/money";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import { formatQuantity } from "@/lib/sales/format";
import { formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import {
  defaultAdditionalRules,
  type AdditionalKind,
} from "@/lib/sales/additional";
import { saveAdditionalRules, type AdditionalData } from "./actions";

/** Баллы и пороги — дробные числа без валюты: «1,5». */
function NumberInput({
  value,
  onChange,
  ...rest
}: {
  value: number;
  onChange: (v: number) => void;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value).replace(".", ",") : "");
  return (
    <Input
      {...rest}
      inputMode="decimal"
      className="w-28 text-right tabular-nums"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const raw = e.target.value.replace(/\s/g, "").replace(",", ".");
        onChange(raw === "" ? NaN : Number(raw));
      }}
    />
  );
}

const valid = (n: number) => Number.isFinite(n) && n >= 0;

export function AdditionalRulesEditor({
  data,
  onClose,
  onSaved,
}: {
  data: AdditionalData;
  onClose: () => void;
  onSaved: (d: AdditionalData) => void;
}) {
  const [initialConfig] = useState(() =>
    structuredClone(
      data.rules.find((r) => r.valid_from <= data.nextFrom)?.config ??
        defaultAdditionalRules,
    ),
  );
  const [config, setConfig] = useState(() => structuredClone(initialConfig));
  const [from, setFrom] = useState(data.nextFrom),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [showErrors, setShowErrors] = useState(false),
    [openBranches, setOpenBranches] = useState<string | null>(null);
  const [tab, setTab] = useState<AdditionalKind>("bar");
  const dirty =
    JSON.stringify(config) !== JSON.stringify(initialConfig) ||
    reason.trim() !== "" ||
    from !== data.nextFrom;
  const { guard, dialog } = useDiscardGuard(dirty, "Новые правила не сохранятся");
  const ratesValid =
    (["bar", "masters"] as const).every((k) => config[k].every((g) => valid(g.rate))) &&
    config.tiers.every((t) => valid(t.from) && valid(t.rate));
  const reasonError =
    reason.trim().length < 3 ? "Напишите причину, не короче 3 символов" : null;

  const setRate = (kind: AdditionalKind, i: number, rate: number) =>
    setConfig((c) => ({
      ...c,
      [kind]: c[kind].map((x, j) => (j === i ? { ...x, rate } : x)),
    }));
  async function save() {
    setShowErrors(true);
    setError(null);
    if (!ratesValid) {
      setError("Проверьте ставки: нужны неотрицательные числа во всех полях");
      return;
    }
    if (reasonError || !from) {
      document.getElementById("additional-reason")?.focus();
      return;
    }
    setBusy(true);
    try {
      const next = await saveAdditionalRules({
        venueId: data.venueId,
        version: data.version,
        from,
        config,
        reason: reason.trim(),
      });
      onSaved(next);
      toast.success("Новая версия правил сохранена");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правила");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <EditDrawer
        open
        onOpenChange={(v) => {
          if (!v && !busy) guard(onClose);
        }}
        title="Правила допродаж"
        description="Новая версия ставок и категорий Quick Resto"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => guard(onClose)}>
              Отмена
            </Button>
            <Button className="min-w-32" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? "Сохраняем…" : "Сохранить версию"}
            </Button>
          </>
        }
      >
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as AdditionalKind)}
          className={tabStyle.tabs}
        >
          <TabsList aria-label="Вид допродаж">
            <TabsTrigger value="bar">Бар</TabsTrigger>
            <TabsTrigger value="masters">Кальяны</TabsTrigger>
          </TabsList>
          {(["bar", "masters"] as const).map((kind) => (
            <TabsContent value={kind} key={kind} className="space-y-9">
              <DrawerSection
                title={kind === "bar" ? "Прибавка за продажу" : "Баллы за продажу"}
                description={
                  kind === "bar"
                    ? "Рублей за одну продажу позиции из категории"
                    : "Баллов мастеру за одну продажу из категории"
                }
              >
                <ul className="divide-y">
                  {config[kind].map((g, i) => {
                    const key = `${kind}-${g.id}`;
                    const open = openBranches === key;
                    const invalid = showErrors && !valid(g.rate);
                    return (
                      <li key={g.id} className="space-y-2 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <label htmlFor={`rate-${key}`} className="min-w-0 text-sm font-medium">
                            {g.label}
                          </label>
                          {kind === "bar" ? (
                            <AmountInput
                              id={`rate-${key}`}
                              aria-invalid={invalid || undefined}
                              className="w-32"
                              value={Number.isFinite(g.rate) ? g.rate : null}
                              onChange={(v) => setRate(kind, i, v ?? NaN)}
                            />
                          ) : (
                            <NumberInput
                              id={`rate-${key}`}
                              aria-invalid={invalid || undefined}
                              value={g.rate}
                              onChange={(v) => setRate(kind, i, v)}
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={`branches-${key}`}
                          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
                          onClick={() => setOpenBranches(open ? null : key)}
                        >
                          Категории Quick Resto · {g.branches.filter(Boolean).length}
                          <ChevronDown
                            aria-hidden
                            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                          />
                        </button>
                        {open && (
                          <div id={`branches-${key}`} className="space-y-1">
                            <Textarea
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
                            <p className="text-xs text-muted-foreground">
                              Одна категория в строке, как в Quick Resto
                            </p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </DrawerSection>
              {kind === "masters" && (
                <DrawerSection
                  title="Прибавка за целый балл"
                  description="Берётся ставка достигнутого порога. Дробная часть баллов не оплачивается"
                >
                  <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <span>От баллов</span>
                    <span>Рублей за балл</span>
                  </div>
                  {config.tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-2 gap-3">
                      <NumberInput
                        aria-label={`Порог баллов ${i + 1}`}
                        aria-invalid={(showErrors && !valid(t.from)) || undefined}
                        value={t.from}
                        onChange={(v) =>
                          setConfig((c) => ({
                            ...c,
                            tiers: c.tiers.map((x, j) => (j === i ? { ...x, from: v } : x)),
                          }))
                        }
                      />
                      <AmountInput
                        aria-label={`Рублей за балл ${i + 1}`}
                        aria-invalid={(showErrors && !valid(t.rate)) || undefined}
                        value={Number.isFinite(t.rate) ? t.rate : null}
                        onChange={(v) =>
                          setConfig((c) => ({
                            ...c,
                            tiers: c.tiers.map((x, j) =>
                              j === i ? { ...x, rate: v ?? NaN } : x,
                            ),
                          }))
                        }
                      />
                    </div>
                  ))}
                </DrawerSection>
              )}
            </TabsContent>
          ))}
        </Tabs>
        <DrawerSection title="Новая версия">
          <Field id="additional-from" label="Действует с" required hint="Уже посчитанные дни не меняются">
            {(control) => (
              <DatePicker
                id={control.id}
                value={from}
                onChange={setFrom}
                fromDate={new Date(data.nextFrom + "T00:00:00")}
                clearable={false}
              />
            )}
          </Field>
          <Field
            id="additional-reason"
            label="Причина изменения"
            required
            error={showErrors ? reasonError : null}
          >
            {(control) => (
              <Textarea
                {...control}
                aria-required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                placeholder="Например, новые цены в барной карте"
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DrawerSection>
        <DrawerSection title="История правил">
          <ul className="divide-y text-sm">
            {data.rules.map((r) => (
              <li key={r.id} className="space-y-1 py-3">
                <p className="font-medium">С {formatDayMonth(r.valid_from)}</p>
                {r.reason && <p className="break-words text-muted-foreground">{r.reason}</p>}
                <p className="text-xs text-muted-foreground">
                  {formatDayMonthTime(r.created_at, new Date(), data.timezone)}
                  {" · "}
                  {r.config[tab]
                    .map(
                      (g) =>
                        `${g.label} ${tab === "bar" ? formatRub(g.rate, { fraction: "auto" }) : `${formatQuantity(g.rate)} б.`}`,
                    )
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </DrawerSection>
      </EditDrawer>
      {dialog}
    </>
  );
}

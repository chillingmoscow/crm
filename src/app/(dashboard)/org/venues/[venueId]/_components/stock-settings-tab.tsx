"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { MultiOptionPicker } from "@/components/shared/multi-option-picker";
import {
  loadStockRules,
  saveStockRules,
  type StockRuleData,
} from "@/app/(dashboard)/documents/writeoffs/rule-actions";
import {
  deductionRulesSchema,
  readLines,
  splitLabels,
  type DeductionRules,
} from "@/lib/stock/deduction-rules";
import { dayLabel } from "@/lib/sales/format";
function numeric(s: string) {
  if (!/^\d+(?:[.,]\d+)?$/.test(s.trim()))
    throw new Error("Заполните числовые поля");
  return Number(s.trim().replace(",", "."));
}
function RulesForm({
  initial,
  onSaved,
}: {
  initial: StockRuleData;
  onSaved: (d: StockRuleData) => void;
}) {
  const router = useRouter();
  const [config, setConfig] = useState(initial.draft),
    [numbers, setNumbers] = useState({
      companyAllowance: String(initial.draft.companyAllowance),
      multiplier: String(initial.draft.multiplier),
      ingredientTolerance: String(initial.draft.ingredientTolerance),
    }),
    [shares, setShares] = useState<Record<string, string>>(
      Object.fromEntries(
        initial.draft.groups.map((g) => [g.id, String(g.share)]),
      ),
    ),
    [from, setFrom] = useState(
      initial.versions[0]?.valid_from &&
        initial.versions[0].valid_from > initial.today
        ? initial.versions[0].valid_from
        : initial.today,
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const set = <K extends keyof DeductionRules>(
    key: K,
    value: DeductionRules[K],
  ) => setConfig((c) => ({ ...c, [key]: value }));
  const groupSet = (
    id: string,
    patch: Partial<DeductionRules["groups"][number]>,
  ) =>
    set(
      "groups",
      config.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    );
  const [lists, setLists] = useState({
    inventoryExclusions: config.inventoryExclusions.join("\n"),
    roleSpecificCategories: config.roleSpecificCategories.join("\n"),
    writeoffReasons: config.writeoffReasons.join("\n"),
  });
  const [groupLists, setGroupLists] = useState<Record<string, string>>(
    Object.fromEntries(
      config.groups.map((g) => [g.id, g.categories.join("\n")]),
    ),
  );
  async function save() {
    setBusy(true);
    try {
      const next = deductionRulesSchema.parse({
        ...config,
        ...Object.fromEntries(
          Object.entries(numbers).map(([k, v]) => [k, numeric(v)]),
        ),
        ...Object.fromEntries(
          Object.entries(lists).map(([k, v]) => [k, readLines(v)]),
        ),
        groups: config.groups.map((g) => ({
          ...g,
          share: numeric(shares[g.id] ?? ""),
          categories: readLines(groupLists[g.id] ?? ""),
        })),
      });
      if (!reason.trim()) throw new Error("Укажите основание изменения");
      const d = await saveStockRules({
        venueId: initial.venueId,
        expectedVersion: initial.versions[0]?.version ?? 0,
        validFrom: from,
        config: next,
        reason,
      });
      onSaved(d);
      router.refresh();
      toast.success("Новая версия правил сохранена");
    } catch (e) {
      toast.error(
        e instanceof z.ZodError
          ? e.issues[0]?.message
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить правила",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Инвентаризация и удержания</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {initial.versions[0]
              ? `Версия ${initial.versions[0].version} · с ${dayLabel(initial.versions[0].valid_from)}`
              : initial.hasLegacy
                ? "Параметры Glide подготовлены для сохранения"
                : "Правила ещё не сохранены"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            До завершения сверки удержания автоматически не начисляются.
          </p>
        </div>
        <Button type="submit" disabled={busy || !initial.canEdit}>
          {busy ? "Сохраняем…" : "Сохранить правила"}
        </Button>
      </div>
      <fieldset
        disabled={busy || !initial.canEdit}
        className="min-w-0 space-y-7"
      >
        <section className="space-y-5 border-b pb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="stock-enabled">Учитывать недостачу</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Общие списания и результаты инвентаризации
              </p>
            </div>
            <Switch
              id="stock-enabled"
              checked={config.enabled}
              onCheckedChange={(v) => set("enabled", v)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="stock-allowance">
                Лимит за счёт заведения, ₽
              </Label>
              <Input
                id="stock-allowance"
                inputMode="decimal"
                value={numbers.companyAllowance}
                onChange={(e) =>
                  setNumbers((n) => ({
                    ...n,
                    companyAllowance: e.target.value,
                  }))
                }
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Сотрудникам распределяется только превышение этого лимита.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock-split">Распределение удержания</Label>
              <Select
                value={config.split}
                onValueChange={(v) =>
                  set("split", v as DeductionRules["split"])
                }
              >
                <SelectTrigger id="stock-split">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(splitLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-semibold">Инвентаризация</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="stock-multiplier">Коэффициент недостачи</Label>
              <Input
                id="stock-multiplier"
                inputMode="decimal"
                value={numbers.multiplier}
                onChange={(e) =>
                  setNumbers((n) => ({ ...n, multiplier: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock-tolerance">
                Погрешность на ингредиент, ₽
              </Label>
              <Input
                id="stock-tolerance"
                inputMode="decimal"
                value={numbers.ingredientTolerance}
                onChange={(e) =>
                  setNumbers((n) => ({
                    ...n,
                    ingredientTolerance: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <details className="rounded-lg border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Исключения · {readLines(lists.inventoryExclusions).length}
            </summary>
            <div className="mt-4 space-y-2">
              <Label htmlFor="stock-exclusions">
                Группы, подгруппы и товары
              </Label>
              <Textarea
                id="stock-exclusions"
                rows={8}
                value={lists.inventoryExclusions}
                onChange={(e) =>
                  setLists((l) => ({
                    ...l,
                    inventoryExclusions: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                По одному названию Quick Resto в строке.
              </p>
            </div>
          </details>
        </section>
        <section className="space-y-4 border-b pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">Распределение между сотрудниками</h3>
            <Select
              value={config.distribution}
              onValueChange={(v) =>
                set("distribution", v as DeductionRules["distribution"])
              }
            >
              <SelectTrigger
                className="w-full sm:w-56"
                aria-label="Способ распределения"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="groups">По группам должностей</SelectItem>
                <SelectItem value="shifts">По количеству смен</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {config.distribution === "groups" && (
            <div className="divide-y rounded-lg border">
              {config.groups.map((g) => (
                <div key={g.id} className="space-y-3 p-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex">
                    <Input
                      aria-label="Название группы"
                      value={g.name}
                      onChange={(e) => groupSet(g.id, { name: e.target.value })}
                      className="col-span-2 min-w-0 sm:flex-1"
                    />
                    <div className="relative w-24 shrink-0">
                      <Input
                        aria-label={`Доля группы ${g.name}, %`}
                        inputMode="decimal"
                        value={shares[g.id] ?? ""}
                        onChange={(e) =>
                          setShares((s) => ({ ...s, [g.id]: e.target.value }))
                        }
                        className="pr-7 text-right"
                      />
                      <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Удалить группу ${g.name}`}
                      onClick={() =>
                        set(
                          "groups",
                          config.groups.filter((x) => x.id !== g.id),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <MultiOptionPicker
                    label={`Должности группы ${g.name}`}
                    placeholder="Выберите должности"
                    searchPlaceholder="Найти должность"
                    selectedIds={g.roleIds}
                    onChange={(ids) => groupSet(g.id, { roleIds: ids })}
                    options={initial.roles.map((r) => ({
                      id: r.id,
                      label: r.archived_at ? `${r.name} · в архиве` : r.name,
                      disabled:
                        (!!r.archived_at && !g.roleIds.includes(r.id)) ||
                        config.excludedRoleIds.includes(r.id) ||
                        config.groups.some(
                          (x) => x.id !== g.id && x.roleIds.includes(r.id),
                        ),
                    }))}
                  />
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      Категории недостачи для группы ·{" "}
                      {readLines(groupLists[g.id] ?? "").length}
                    </summary>
                    <Textarea
                      aria-label={`Категории группы ${g.name}`}
                      className="mt-3"
                      value={groupLists[g.id] ?? ""}
                      onChange={(e) =>
                        setGroupLists((x) => ({ ...x, [g.id]: e.target.value }))
                      }
                      rows={3}
                    />
                  </details>
                </div>
              ))}
            </div>
          )}
          {config.distribution === "groups" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = crypto.randomUUID();
                  set("groups", [
                    ...config.groups,
                    {
                      id,
                      name: "Новая группа",
                      share: 0,
                      roleIds: [],
                      categories: [],
                    },
                  ]);
                  setShares((s) => ({ ...s, [id]: "0" }));
                }}
              >
                <Plus className="mr-2 size-4" />
                Добавить группу
              </Button>
              <p className="text-sm text-muted-foreground">
                Всего{" "}
                {config.groups
                  .reduce(
                    (n, g) =>
                      n + (Number(shares[g.id]?.replace(",", ".")) || 0),
                    0,
                  )
                  .toLocaleString("ru-RU")}{" "}
                из 100%
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label>Не участвуют в общем распределении</Label>
            <MultiOptionPicker
              label="Исключённые должности"
              placeholder="Выберите должности"
              searchPlaceholder="Найти должность"
              selectedIds={config.excludedRoleIds}
              onChange={(ids) => set("excludedRoleIds", ids)}
              options={initial.roles.map((r) => ({
                id: r.id,
                label: r.archived_at ? `${r.name} · в архиве` : r.name,
                disabled:
                  (!!r.archived_at && !config.excludedRoleIds.includes(r.id)) ||
                  config.groups.some((g) => g.roleIds.includes(r.id)),
              }))}
            />
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Категории, распределяемые по должностям
            </summary>
            <Textarea
              aria-label="Категории по должностям"
              className="mt-3"
              rows={4}
              value={lists.roleSpecificCategories}
              onChange={(e) =>
                setLists((l) => ({
                  ...l,
                  roleSpecificCategories: e.target.value,
                }))
              }
            />
          </details>
        </section>
        <section className="space-y-3 border-b pb-6">
          <h3 className="font-semibold">Складские списания</h3>
          <Label htmlFor="stock-reasons">
            Причины, относимые на сотрудников
          </Label>
          <Textarea
            id="stock-reasons"
            rows={3}
            value={lists.writeoffReasons}
            onChange={(e) =>
              setLists((l) => ({ ...l, writeoffReasons: e.target.value }))
            }
          />
          <p className="text-xs text-muted-foreground">
            По одному названию причины Quick Resto в строке.
          </p>
        </section>
        <section className="space-y-4">
          <h3 className="font-semibold">Начало действия</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="stock-valid-from">Применять с</Label>
              <DatePicker
                id="stock-valid-from"
                value={from}
                onChange={setFrom}
                clearable={false}
                fromDate={new Date(`${initial.today}T00:00:00`)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock-reason">Основание изменения</Label>
              <Input
                id="stock-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например, изменили доли должностей"
                maxLength={1000}
              />
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Сохраняется новая версия. Прежние правила и уже записанные расчёты
            остаются в истории.
          </p>
        </section>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !initial.canEdit}>
          {busy ? "Сохраняем…" : "Сохранить правила"}
        </Button>
      </div>
      {initial.versions.length > 0 && (
        <details className="border-t pt-5">
          <summary className="cursor-pointer text-sm font-medium">
            История правил · {initial.versions.length}
          </summary>
          <ol className="mt-3 divide-y">
            {initial.versions.map((v) => (
              <li key={v.id} className="space-y-1 py-3 text-sm">
                <p className="font-medium">
                  Версия {v.version} · с {dayLabel(v.valid_from)}
                </p>
                <p>{v.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {v.actor_name} ·{" "}
                  {new Date(v.created_at).toLocaleString("ru-RU", {
                    timeZone: initial.timezone,
                  })}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </form>
  );
}
export function StockSettingsTab({ venueId }: { venueId: string }) {
  const [data, setData] = useState<StockRuleData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadStockRules(venueId)
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [venueId]);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data)
    return (
      <div className="space-y-5" aria-label="Загружаем правила удержаний">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-60 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  return (
    <div className="max-w-4xl">
      <RulesForm
        key={`${data.venueId}:${data.versions[0]?.version ?? 0}`}
        initial={data}
        onSaved={setData}
      />
    </div>
  );
}

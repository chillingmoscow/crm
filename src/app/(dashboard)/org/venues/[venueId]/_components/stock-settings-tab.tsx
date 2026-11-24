"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { AmountInput } from "@/components/finance/amount-input";
import { ProfileSection } from "@/components/shared/profile-section";
import { formatRub } from "@/components/shared/money";
import { useSaveSection } from "@/components/shared/save-bar";
import { formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import {
  loadStockRules,
  saveStockRules,
  type StockRuleData,
} from "@/app/(dashboard)/documents/writeoffs/rule-actions";
import { unwrapAction } from "@/lib/actions/result";
import {
  deductionRulesSchema,
  readLines,
  type DeductionRules,
} from "@/lib/stock/deduction-rules";
import { sharesFromRules, sharesTotal } from "@/lib/stock/department-shares";
import { DeductionRecalculate } from "@/app/(dashboard)/inventory/_components/deduction-recalculate";
import { ExclusionsRow } from "./exclusions-sheet";
import { RuleHistory } from "./rule-history";

const day = (date: string) => formatDayMonth(date) ?? date;
const rub = (n: number) => formatRub(n, { fraction: "auto" });

function ShareSummary({
  config,
  departments,
}: {
  config: DeductionRules;
  departments: StockRuleData["departments"];
}) {
  const used = new Set([
    ...config.groups.flatMap((g) => g.departmentIds ?? []),
    ...(config.excludedDepartmentIds ?? []),
  ]);
  const visible = departments.filter((d) => !d.archived_at || used.has(d.id));
  const shares = sharesFromRules(
    config,
    visible.map((d) => d.id),
  );
  const total = sharesTotal(shares);
  const archivedInGroups = visible.filter(
    (d) =>
      d.archived_at &&
      config.groups.some((g) => g.departmentIds?.includes(d.id)),
  );
  const warnings = [
    ...(Math.abs(total - 100) > 0.000001
      ? [`Сумма долей ${total.toLocaleString("ru-RU")}%, должна быть 100%.`]
      : []),
    ...(archivedInGroups.length
      ? [
          `Архивное подразделение в распределении: ${archivedInGroups.map((d) => d.name).join(", ")}.`,
        ]
      : []),
  ];
  return (
    <ProfileSection
      title="Распределение между сотрудниками"
      description={
        visible.some((d) => !d.archived_at)
          ? "Сначала сумма делится между подразделениями по их долям, затем доля подразделения делится между его сотрудниками пропорционально количеству смен. Доли меняются на странице подразделения."
          : "Подразделения ещё не настроены. Создайте их и укажите в настройках должностей."
      }
    >
      {visible.length > 0 && (
        <div className="divide-y rounded-lg border">
          {visible.map((d, i) => (
            <div
              key={d.id}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 text-sm"
            >
              <Link
                href={`/people/departments/${d.id}`}
                className="min-w-0 truncate text-brand underline-offset-4 hover:underline"
              >
                {d.name}
                {d.archived_at ? " · в архиве" : ""}
              </Link>
              <span className="w-14 text-right tabular-nums">
                {shares[i].participates
                  ? `${shares[i].share.toLocaleString("ru-RU")}%`
                  : "—"}
              </span>
              <span className="w-28 text-right text-muted-foreground">
                {shares[i].participates ? "участвует" : "не участвует"}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Всего {total.toLocaleString("ru-RU")} из 100%
      </p>
      {warnings.map((w) => (
        <p key={w} role="alert" className="text-sm text-destructive">
          {w}
        </p>
      ))}
    </ProfileSection>
  );
}

type FormState = {
  config: DeductionRules;
  companyAllowance: number | null;
  ingredientTolerance: number | null;
  from: string;
  reason: string;
};

/**
 * Исходные значения формы. Править может только владелец — ему показываем
 * черновик (подготовленный из сохранённой версии или из Glide); остальным —
 * сохранённую версию целиком, включая лимит и погрешность.
 */
function initialForm(initial: StockRuleData): FormState {
  const config = initial.canEdit
    ? initial.draft
    : (initial.versions[0]?.config ?? initial.draft);
  return {
    config,
    companyAllowance: config.companyAllowance,
    ingredientTolerance: config.ingredientTolerance,
    from:
      initial.versions[0]?.valid_from &&
      initial.versions[0].valid_from > initial.today
        ? initial.versions[0].valid_from
        : initial.today,
    reason: "",
  };
}

function RulesForm({
  initial,
  onSaved,
}: {
  initial: StockRuleData;
  onSaved: (d: StockRuleData) => void;
}) {
  const router = useRouter();
  const base = initialForm(initial);
  const [form, setForm] = useState<FormState>(base);
  const [busy, setBusy] = useState(false);
  // Новая сохранённая версия — новая точка отсчёта для изменений. Форма не
  // перемонтируется: иначе общая полоса потеряла бы соседние секции
  // (граница исключений), которые сохраняются тем же нажатием.
  const savedKey = `${initial.venueId}:${initial.versions[0]?.version ?? 0}:${initial.canEdit}`;
  const [formKey, setFormKey] = useState(savedKey);
  if (formKey !== savedKey) {
    setFormKey(savedKey);
    setForm(base);
  }
  const { config } = form;
  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));
  const canEdit = initial.canEdit;
  const dirty =
    canEdit &&
    (config.enabled !== base.config.enabled ||
      form.companyAllowance !== base.companyAllowance ||
      form.ingredientTolerance !== base.ingredientTolerance ||
      form.from !== base.from ||
      form.reason.trim() !== "");
  const blocked =
    form.companyAllowance === null || form.ingredientTolerance === null
      ? "Укажите лимит и погрешность"
      : !form.reason.trim()
        ? "Укажите основание изменения"
        : null;

  async function save() {
    if (!canEdit || blocked) return false;
    setBusy(true);
    try {
      const next = deductionRulesSchema.parse({
        ...config,
        split: "once",
        multiplier: 1,
        // Единственная логика распределения: доля подразделения, внутри — по
        // сменам. Режимы «по должностям» и «по сменам» из Glide больше не
        // выбираются; сохранение старой версии переводит её на подразделения.
        distribution: "departments",
        companyAllowance: form.companyAllowance,
        ingredientTolerance: form.ingredientTolerance,
        roleSpecificCategories: readLines(
          config.roleSpecificCategories.join("\n"),
        ),
        writeoffReasons: readLines(config.writeoffReasons.join("\n")),
        // Доли групп и «не участвуют» правятся на странице подразделения;
        // здесь они переносятся в новую версию как есть.
        groups: config.groups,
        excludedDepartmentIds: config.excludedDepartmentIds ?? [],
      });
      const d = unwrapAction(
        await saveStockRules({
          venueId: initial.venueId,
          expectedVersion: initial.versions[0]?.version ?? 0,
          validFrom: form.from,
          config: next,
          reason: form.reason,
        }),
      );
      onSaved(d.data);
      router.refresh();
      toast.success("Новая версия правил сохранена");
      // Пересчёт удержания текущего месяца (если автопересчёт включён): не теряем результат.
      if (d.deductionNotice) toast.message(d.deductionNotice);
      return true;
    } catch (e) {
      toast.error(
        e instanceof z.ZodError
          ? (e.issues[0]?.message ?? "Проверьте правила")
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить правила",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const saveBar = useSaveSection({
    dirty,
    saving: busy,
    blocked,
    save,
    reset: () => setForm(base),
  });

  const latest = initial.versions[0];
  const disabled = busy || !canEdit;
  return (
    <form
      onSubmit={(e) => {
        // Enter в поле сохраняет, как кнопка в полосе.
        e.preventDefault();
        if (dirty && !blocked && !busy) void save();
      }}
      className="flex flex-col gap-5"
    >
      <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      <ProfileSection
        title="Инвентаризация и удержания"
        description={
          latest
            ? `Сохранённая версия ${latest.version} · с ${day(latest.valid_from)}`
            : initial.hasLegacy
              ? "Параметры Glide подготовлены для сохранения"
              : "Правила ещё не сохранены"
        }
        locked={
          canEdit
            ? undefined
            : { tone: "locked", message: "Правила удержаний меняет владелец" }
        }
      >
        <p className="text-[13px] text-muted-foreground">
          До завершения сверки удержания автоматически не начисляются.
        </p>
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="stock-enabled">Учитывать недостачу</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Общие списания и результаты инвентаризации
              </p>
            </div>
            <Switch
              id="stock-enabled"
              checked={config.enabled}
              onCheckedChange={(v) =>
                set({ config: { ...config, enabled: v } })
              }
            />
          </div>
          <Field
            id="stock-allowance"
            label="Лимит за счёт заведения"
            required
            hint="Сотрудникам распределяется только превышение этого лимита."
            error={
              canEdit && form.companyAllowance === null
                ? "Укажите сумму"
                : undefined
            }
            className="sm:max-w-xs"
          >
            {(control) => (
              <AmountInput
                id={control.id}
                value={form.companyAllowance}
                disabled={disabled}
                onChange={(v) => set({ companyAllowance: v })}
              />
            )}
          </Field>
        </fieldset>
      </ProfileSection>

      <ProfileSection title="Инвентаризация">
        <fieldset disabled={disabled} className="min-w-0">
          <Field
            id="stock-tolerance"
            label="Погрешность на ингредиент"
            required
            hint="До этой суммы включительно позиция не учитывается. Если больше, учитывается целиком."
            error={
              canEdit && form.ingredientTolerance === null
                ? "Укажите сумму"
                : undefined
            }
            className="sm:max-w-xs"
          >
            {(control) => (
              <AmountInput
                id={control.id}
                value={form.ingredientTolerance}
                disabled={disabled}
                onChange={(v) => set({ ingredientTolerance: v })}
              />
            )}
          </Field>
        </fieldset>
        {/* Вне fieldset: список исключений открывается и без права менять
            правила удержаний, правка внутри панели — по своему праву. */}
        <ExclusionsRow venueId={initial.venueId} today={initial.today} />
      </ProfileSection>

      <ShareSummary config={config} departments={initial.departments} />

      <ProfileSection
        title="Начало действия"
        description="Сохраняется новая версия. Прежние правила и уже записанные расчёты остаются в истории."
      >
        <fieldset
          disabled={disabled}
          className="grid min-w-0 gap-4 sm:grid-cols-2"
        >
          <Field id="stock-valid-from" label="Применять с" required>
            {(control) => (
              <DatePicker
                id={control.id}
                value={form.from}
                onChange={(from) => set({ from })}
                clearable={false}
                disabled={disabled}
                fromDate={new Date(`${initial.today}T00:00:00`)}
              />
            )}
          </Field>
          <Field id="stock-reason" label="Основание изменения" required>
            {(control) => (
              <Input
                {...control}
                value={form.reason}
                onChange={(e) => set({ reason: e.target.value })}
                placeholder="Например, изменили доли подразделений"
                maxLength={1000}
              />
            )}
          </Field>
        </fieldset>
        {initial.versions.length > 0 && (
          <RuleHistory count={initial.versions.length}>
            <ol className="divide-y">
              {initial.versions.map((v) => (
                <li key={v.id} className="space-y-1 py-3 text-sm">
                  <p className="font-medium">
                    Версия {v.version} · с {day(v.valid_from)}
                  </p>
                  <p>{v.reason}</p>
                  <RuleHistory label="Параметры этой версии" className="py-1">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>Лимит заведения: {rub(v.config.companyAllowance)}</p>
                      <p>
                        Распределение:{" "}
                        {v.config.distribution === "departments"
                          ? "по подразделениям"
                          : v.config.distribution === "groups"
                            ? "по должностям"
                            : "по количеству смен"}
                      </p>
                      {v.config.groups.map((g) => (
                        <p key={g.id}>
                          {g.name}: {g.share}% ·{" "}
                          {(v.config.distribution === "departments"
                            ? (g.departmentIds ?? []).map(
                                (id) =>
                                  initial.departments.find((d) => d.id === id)
                                    ?.name ?? "Удалённое подразделение",
                              )
                            : g.roleIds.map(
                                (id) =>
                                  initial.roles.find((r) => r.id === id)
                                    ?.name ?? "Удалённая должность",
                              )
                          ).join(", ") || "Не назначено"}
                        </p>
                      ))}
                    </div>
                  </RuleHistory>
                  <p className="text-xs text-muted-foreground">
                    {v.actor_name} · {formatDayMonthTime(v.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          </RuleHistory>
        )}
      </ProfileSection>
      {saveBar}
    </form>
  );
}

export function StockSettingsTab({ venueId }: { venueId: string }) {
  const [data, setData] = useState<StockRuleData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadStockRules(venueId)
      .then(unwrapAction)
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
      <div className="flex flex-col gap-5" aria-label="Загружаем правила удержаний">
        <div className="h-40 animate-pulse rounded-[14px] bg-muted" />
        <div className="h-60 animate-pulse rounded-[14px] bg-muted" />
      </div>
    );
  return (
    <div className="flex flex-col gap-5">
      <RulesForm key={data.venueId} initial={data} onSaved={setData} />
      <DeductionRecalculate venueId={data.venueId} today={data.today} />
    </div>
  );
}

"use client";
import Link from "next/link";
import { DisciplineSettings } from "./discipline-settings";
import { AutomationSettings } from "./automation-settings";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OptionSelect } from "@/components/ui/option-select";
import { ProfileSection } from "@/components/shared/profile-section";
import { SaveBarScope, useSaveSection } from "@/components/shared/save-bar";
import { PayrollExperiencePolicy } from "./payroll-experience-policy";
import type { PayrollData } from "@/lib/payroll/types";
import { loadPayrollRules, payrollCommand } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { selectClass } from "./employee-pay";
import { PayrollSetup } from "./payroll-setup";
import { PayrollInitialData } from "./payroll-initial-data";

/** Значения формы «Выдача чаевых и финансы» — для сравнения с сохранёнными. */
type TipForm = {
  comments: string;
  category: string;
  salaryCategory: string;
  cashAccounts: Record<string, string>;
};
const tipForm = (d: PayrollData): TipForm => ({
  comments: d.settings?.tip_comments.join("\n") ?? "чаевые",
  category: d.settings?.tip_category_id ?? "",
  salaryCategory: d.settings?.salary_category_id ?? "",
  cashAccounts: d.settings?.cashbox_accounts ?? {},
});
/** Пустой счёт кассы не сохраняется — и не считается изменением. */
const sameTipForm = (a: TipForm, b: TipForm) => {
  const accounts = (v: Record<string, string>) =>
    JSON.stringify(
      Object.entries(v)
        .filter(([, id]) => id)
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  return (
    a.comments.trim() === b.comments.trim() &&
    a.category === b.category &&
    a.salaryCategory === b.salaryCategory &&
    accounts(a.cashAccounts) === accounts(b.cashAccounts)
  );
};

/**
 * Настройки оплаты труда заведения (вкладка «Оплата труда» карточки
 * заведения и `/org/venues/[id]/payroll`). Секции — `ProfileSection`;
 * правки на месте сохраняет одна полоса `SaveBar` внизу (DS «SaveBar»):
 * «Выдача чаевых и финансы», «Автоматические правила» и «Медкнижки, форма и
 * мотивация» подключены к ней как отдельные секции, уход с изменениями
 * спрашивает подтверждение.
 */
export function PayrollSettings({ venueId }: { venueId: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <SaveBarScope>
        <PayrollSettingsSections venueId={venueId} />
      </SaveBarScope>
    </div>
  );
}

function PayrollSettingsSections({ venueId }: { venueId: string }) {
  const [data, setData] = useState<PayrollData | null>(null),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    const d = unwrapAction(await loadPayrollRules());
    if (d.venueId !== venueId)
      throw new Error(
        "Выберите это заведение в переключателе, чтобы изменить его условия оплаты",
      );
    if (!d.permissions.includes("payroll.configure"))
      throw new Error("Нет доступа к настройке оплаты труда");
    setData(d);
  }, [venueId]);
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [reload]); // scoped server loader protects other venues
  if (error)
    return (
      <ProfileSection title="Оплата труда">
        <p className="text-sm text-muted-foreground">{error}</p>
      </ProfileSection>
    );
  if (!data)
    return (
      <p className="py-5 text-sm text-muted-foreground">
        Загружаем условия оплаты…
      </p>
    );
  const roles = (data.roles ?? []).filter((r) =>
    data.models.some(
      (m) => m.role_id === r.id && m.is_role_default && !m.archived,
    ),
  );
  return (
    <div className="space-y-6">
      <PayrollSetup data={data} onChange={reload} />
      <PayrollExperiencePolicy settings={data.settings} onChange={reload} />
      <DisciplineSettings />
      <AutomationSettings key={venueId} venueId={venueId} />
      <ProfileSection
        title="Оплата должностей"
        description="Условия оплаты задаются в карточке должности."
      >
        {roles.length ? (
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <Button key={r.id} variant="outline" size="sm" asChild>
                <Link href={`/people/roles/${r.id}?tab=compensation`}>
                  {r.name}
                </Link>
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Оплата пока не задана ни для одной должности
          </p>
        )}
      </ProfileSection>
      <TipSettings data={data} onSaved={reload} />
      <PayrollInitialData venueId={venueId} />
    </div>
  );
}

function TipSettings({
  data,
  onSaved,
}: {
  data: PayrollData;
  onSaved: () => Promise<void>;
}) {
  const saved = tipForm(data);
  const [form, setForm] = useState<TipForm>(saved);
  const [busy, setBusy] = useState(false);
  // Свежие данные после сохранения — новая точка отсчёта для изменений.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setForm(JSON.parse(savedKey) as TipForm);
  }, [savedKey]);
  const canPay =
    data.permissions.includes("payroll.pay") &&
    data.permissions.includes("finance.create_transaction");
  const dirty = canPay && !sameTipForm(form, saved);
  const blocked =
    !form.category || !form.salaryCategory
      ? "Выберите статьи чаевых и зарплаты"
      : null;
  const set = (patch: Partial<TipForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const save = async () => {
    if (!canPay || blocked) return false;
    setBusy(true);
    try {
      unwrapAction(await payrollCommand("settings", {
        tip_comments: form.comments
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        tip_category_id: form.category,
        salary_category_id: form.salaryCategory,
        cashbox_accounts: Object.fromEntries(
          Object.entries(form.cashAccounts).filter(([, value]) => value),
        ),
      }));
      await onSaved();
      toast.success("Настройки сохранены");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveBar = useSaveSection({
    dirty,
    saving: busy,
    blocked,
    save,
    reset: () => setForm(saved),
  });
  const cashboxes = [
    ...new Set([
      ...data.cashbox.map((c) => String(c.kkm_id)),
      ...Object.keys(form.cashAccounts),
    ]),
  ];
  const disabled = !canPay || busy;
  return (
    <ProfileSection
      title="Выдача чаевых и финансы"
      description="Распознаём точное совпадение комментария инкассации. Суммируем операции за рабочий день; до 100 ₽ включительно считаем округлением."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          // Enter в поле сохраняет, как кнопка в полосе.
          e.preventDefault();
          if (dirty && !blocked && !busy) void save();
        }}
      >
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
        {!canPay && (
          <p className="text-[13px] text-muted-foreground">
            Менять эти настройки могут те, у кого есть права на выплаты и
            операции в финансах.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="tip-comments">Комментарии · один на строку</Label>
          <Textarea
            id="tip-comments"
            className="min-h-20"
            value={form.comments}
            disabled={disabled}
            onChange={(e) => set({ comments: e.target.value })}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {cashboxes.map((id) => (
            <div className="space-y-2" key={id}>
              <Label htmlFor={`tip-bank-${id}`}>Касса {id} · счёт выдачи</Label>
              <OptionSelect
                id={`tip-bank-${id}`}
                className={selectClass}
                value={form.cashAccounts[id] ?? ""}
                disabled={disabled}
                onValueChange={(v) =>
                  set({ cashAccounts: { ...form.cashAccounts, [id]: v } })
                }
                placeholder="Не настроен"
                options={[
                  { value: "", label: "Не настроен" },
                  ...data.banks.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            </div>
          ))}
          {!cashboxes.length && (
            <p className="text-sm text-muted-foreground md:col-span-2">
              Кассы появятся после загрузки инкассаций Quick Resto.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="tip-category">Статья чаевых</Label>
            <OptionSelect
              id="tip-category"
              className={selectClass}
              value={form.category}
              disabled={disabled}
              onValueChange={(category) => set({ category })}
              placeholder="Выберите статью"
              options={[
                { value: "", label: "Выберите статью" },
                ...data.categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="salary-category">Статья зарплаты</Label>
            <OptionSelect
              id="salary-category"
              className={selectClass}
              value={form.salaryCategory}
              disabled={disabled}
              onValueChange={(salaryCategory) => set({ salaryCategory })}
              placeholder="Выберите статью"
              options={[
                { value: "", label: "Выберите статью" },
                ...data.categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
        </div>
        {saveBar}
      </form>
    </ProfileSection>
  );
}

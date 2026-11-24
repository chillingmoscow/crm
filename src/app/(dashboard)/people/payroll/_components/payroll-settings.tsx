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
import { Input } from "@/components/ui/input";
import {
  officialMonthOptions,
  sameOfficialForm,
  validateOfficialForm,
  type OfficialSettingsForm,
} from "@/lib/payroll/official-settings";

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
      <OfficialSalarySettings data={data} onSaved={reload} />
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

const officialForm = (d: PayrollData): OfficialSettingsForm => ({
  from: d.settings?.official_from ?? "",
  payDay: String(d.settings?.official_pay_day ?? 5),
  bankId: d.settings?.official_bank_account_id ?? "",
});

function OfficialSalarySettings({
  data,
  onSaved,
}: {
  data: PayrollData;
  onSaved: () => Promise<void>;
}) {
  const saved = officialForm(data);
  const [form, setForm] = useState<OfficialSettingsForm>(saved);
  const [busy, setBusy] = useState(false);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setForm(JSON.parse(savedKey) as OfficialSettingsForm);
  }, [savedKey]);
  const canPay =
    data.permissions.includes("payroll.pay") &&
    data.permissions.includes("finance.create_transaction");
  const startsOn = data.settings?.starts_on ?? "";
  const checking = data.banks.filter((b) => b.type === "checking");
  const dirty = canPay && !sameOfficialForm(form, saved);
  const blocked = validateOfficialForm(
    form,
    startsOn,
    // Сохранённый счёт, который больше не расчётный, остаётся допустимым значением формы только без правок.
    checking.map((b) => b.id),
  );
  const set = (patch: Partial<OfficialSettingsForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const save = async () => {
    if (!canPay || blocked) return false;
    setBusy(true);
    try {
      unwrapAction(
        await payrollCommand("settings", {
          official_from: form.from || null,
          official_pay_day: Number(form.payDay),
          official_bank_account_id: form.bankId || null,
        }),
      );
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
    blocked: dirty ? blocked : null,
    save,
    reset: () => setForm(saved),
  });
  const disabled = !canPay || busy;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ProfileSection
      title="Официальная зарплата"
      description="В указанный день месяца приложение само проводит официальную часть за прошлый месяц сотрудникам, оформленным официально: сумма на руки уходит с расчётного счёта и записывается в финансы."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
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
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="official-from">Учитывать с месяца</Label>
            <OptionSelect
              id="official-from"
              className={selectClass}
              value={form.from}
              disabled={disabled}
              onValueChange={(from) => set({ from })}
              placeholder="Не проводить автоматически"
              options={officialMonthOptions(startsOn || today, saved.from, today)}
            />
            <p className="text-[13px] text-muted-foreground">
              За более ранние месяцы выплаты автоматически не создаются.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="official-pay-day">День проведения</Label>
            <Input
              id="official-pay-day"
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              value={form.payDay}
              disabled={disabled}
              onChange={(e) => set({ payDay: e.target.value })}
            />
            <p className="text-[13px] text-muted-foreground">
              Число от 1 до 28. Выплата проводится этим числом следующего месяца.
            </p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="official-bank">Расчётный счёт по умолчанию</Label>
            <OptionSelect
              id="official-bank"
              className={selectClass}
              value={form.bankId}
              disabled={disabled}
              onValueChange={(bankId) => set({ bankId })}
              placeholder="Не выбран"
              options={[
                { value: "", label: "Не выбран" },
                ...checking.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            <p className="text-[13px] text-muted-foreground">
              Только расчётные счета. Пока счёт не выбран, выплаты не проводятся, а в «На разбор» появляется напоминание.
            </p>
          </div>
        </div>
        {saveBar}
      </form>
    </ProfileSection>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Plus, Target, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRub } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import { kpiSummary, parseKpiItems, type KpiItem } from "@/lib/payroll/kpi";
import { loadKpiTerms, saveKpiTerms, type KpiTermsVersion } from "../kpi-actions";
import { CompensationRow } from "./compensation-summary";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import { PayrollMonthPicker } from "./payroll-month-picker";
import s from "./role-compensation.module.css";

const TYPES: { value: KpiItem["type"]; label: string }[] = [
  { value: "done", label: "Сделано" },
  { value: "each", label: "За каждую" },
  { value: "plan", label: "План продаж алкоголя" },
  { value: "all", label: "Бонус за все" },
];

/** «1 ноября 2026» — для «с …»: в именительном падеже «с ноябрь» звучит криво. */
const sinceLabel = (month: string) =>
  new Date(`${month.slice(0, 10)}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(" г.", "");

const newId = () => `i_${Math.random().toString(36).slice(2, 10)}`;
const nextMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 8) + "01";
};

function retype(item: KpiItem, type: KpiItem["type"]): KpiItem {
  const amount = item.type === "each" ? item.price : item.amount;
  if (type === "each") return { id: item.id, type, label: item.label, price: amount };
  if (type === "plan") return { id: item.id, type, label: item.label, amount, metric: "alcohol_share" };
  if (type === "all") return { id: item.id, type, label: item.label, amount, requires: item.type === "all" ? item.requires : [] };
  return { id: item.id, type, label: item.label, amount };
}

function summaryText(items: KpiItem[]): string {
  const sum = kpiSummary(items);
  const each = sum.each.map((e) => ` + ${formatRub(e.price)} за каждую: ${e.label}`).join("");
  return `${sum.count} ${sum.count % 10 === 1 && sum.count % 100 !== 11 ? "пункт" : sum.count % 10 >= 2 && sum.count % 10 <= 4 && (sum.count % 100 < 12 || sum.count % 100 > 14) ? "пункта" : "пунктов"} · до ${formatRub(sum.max)}${each}`;
}

/** Блок «KPI» в условиях оплаты должности: пункты, «с месяца», причина, история. */
export function RoleKpiTerms({ roleId, roleName }: { roleId: string; roleName: string }) {
  const [versions, setVersions] = useState<KpiTermsVersion[] | null>(null);
  const [canConfigure, setCanConfigure] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<KpiItem[]>([]);
  const [from, setFrom] = useState(nextMonth);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () =>
    loadKpiTerms(roleId).then(unwrapAction).then((r) => { setVersions(r.versions); setCanConfigure(r.canConfigure); });
  useEffect(() => {
    let alive = true;
    loadKpiTerms(roleId).then(unwrapAction)
      .then((r) => { if (alive) { setVersions(r.versions); setCanConfigure(r.canConfigure); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Не удалось загрузить условия KPI"); });
    return () => { alive = false; };
  }, [roleId]);

  if (error) return <p className={s.error}>{error}</p>;
  if (!versions) return null;
  const latest = versions[0] ?? null;

  const edit = () => {
    setDraft(structuredClone(latest?.items ?? [{ id: newId(), type: "done", label: "", amount: 0 }]));
    setFrom(latest && latest.valid_from >= nextMonth() ? latest.valid_from : nextMonth());
    setReason("");
    setOpen(true);
  };
  const patch = (i: number, item: KpiItem) => setDraft(draft.map((d, j) => (j === i ? item : d)));
  const remove = (i: number) => {
    const gone = draft[i].id;
    setDraft(draft.filter((_, j) => j !== i).map((d) => (d.type === "all" ? { ...d, requires: d.requires.filter((r) => r !== gone) } : d)));
  };
  const save = async () => {
    let items: KpiItem[];
    try {
      items = parseKpiItems(draft);
    } catch (e) {
      return toast.error(e instanceof Error ? e.message : "Проверьте пункты KPI");
    }
    setBusy(true);
    try {
      unwrapAction(await saveKpiTerms(roleId, { valid_from: from, items, reason }, latest?.id ?? null));
      toast.success(`Условия KPI сохранены с ${sinceLabel(from)}`);
      await reload();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить условия KPI");
    } finally {
      setBusy(false);
    }
  };

  const doneItems = draft.filter((d) => d.type === "done");
  return (
    <>
      <div className={s.section}><h3>KPI за месяц</h3><span>Итоги отмечают в течение месяца, план засчитывается после его конца</span></div>
      <div className={s.card}>
        <CompensationRow
          title="KPI"
          hint={latest ? `Действуют с ${sinceLabel(latest.valid_from)}` : "Премия за выполненные задачи месяца"}
          icon={<Target size={20} />}
          onEdit={canConfigure ? edit : undefined}
        >
          <strong className={s.value}>{latest ? summaryText(latest.items) : "Не заданы"}</strong>
        </CompensationRow>
      </div>
      <PayrollDetailDialog
        open={open}
        onOpenChange={(v) => { if (!busy) setOpen(v); }}
        title="KPI"
        description={roleName}
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Отмена</Button>
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}Сохранить</Button>
          </div>
        }
      >
        <ul className="space-y-3">
          {draft.map((item, i) => (
            <li key={item.id} className="space-y-3 rounded-lg border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <Select value={item.type} onValueChange={(v) => patch(i, retype(item, v as KpiItem["type"]))}>
                  <SelectTrigger className="w-48 min-w-0" aria-label="Тип пункта"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="ghost" size="sm" className="ml-auto w-9 px-0" aria-label="Удалить пункт" data-tip="Удалить" onClick={() => remove(i)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={`kpi-label-${item.id}`}>Название</Label>
                  <Input id={`kpi-label-${item.id}`} className="text-base sm:text-sm" value={item.label} maxLength={80}
                    onChange={(e) => patch(i, { ...item, label: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`kpi-amount-${item.id}`}>{item.type === "each" ? "За каждую, ₽" : "Сумма, ₽"}</Label>
                  <Input id={`kpi-amount-${item.id}`} type="number" inputMode="decimal" min={0} step="any" className="text-base sm:text-sm"
                    value={(item.type === "each" ? item.price : item.amount) || ""}
                    onChange={(e) => {
                      const n = e.target.value === "" ? 0 : Number(e.target.value);
                      patch(i, item.type === "each" ? { ...item, price: n } : { ...item, amount: n });
                    }} />
                </div>
              </div>
              {item.type === "plan" && <p className="text-[13px] text-muted-foreground">Засчитывается, если продажи алкоголя за месяц не меньше плана</p>}
              {item.type === "all" && (
                <fieldset className="space-y-2">
                  <legend className="text-[13px] text-muted-foreground">Если выполнены все отмеченные пункты</legend>
                  {doneItems.length === 0 && <p className="text-[13px] text-muted-foreground">Сначала добавьте пункты «Сделано»</p>}
                  {doneItems.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={item.requires.includes(d.id)}
                        onCheckedChange={(v) => patch(i, { ...item, requires: v === true ? [...item.requires, d.id] : item.requires.filter((r) => r !== d.id) })}
                      />
                      {d.label || "Без названия"}
                    </label>
                  ))}
                </fieldset>
              )}
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => setDraft([...draft, { id: newId(), type: "done", label: "", amount: 0 }])} disabled={draft.length >= 20}>
          <Plus className="size-4" />Добавить пункт
        </Button>
        <div className={s.effective}>
          <div className="space-y-2">
            <Label>С какого месяца</Label>
            <PayrollMonthPicker variant="field" prefix="" ariaLabel="Месяц начала условий KPI" value={from} min="2026-11-01" onChange={setFrom} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kpi-reason">Причина изменения</Label>
            <Textarea id="kpi-reason" className="text-base sm:text-sm" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        {versions.length > 0 && (
          <section aria-label="История условий KPI" className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">История</h3>
            <ul className="space-y-2 text-[13px]">
              {versions.map((v) => (
                <li key={v.id}>
                  <p className="font-medium">С {sinceLabel(v.valid_from)} · {summaryText(v.items)}</p>
                  <p className="text-muted-foreground">
                    {v.change_reason} · {new Date(v.created_at).toLocaleDateString("ru-RU")}{v.created_by ? ` · ${v.created_by}` : " · система"}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </PayrollDetailDialog>
    </>
  );
}

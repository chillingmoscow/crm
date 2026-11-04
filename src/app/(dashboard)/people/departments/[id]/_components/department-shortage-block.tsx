"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import {
  saveStockRules,
  type StockRuleData,
} from "@/app/(dashboard)/documents/writeoffs/rule-actions";
import { deductionRulesSchema } from "@/lib/stock/deduction-rules";
import {
  multiDepartmentGroupExists,
  rulesWithShares,
  sharesFromRules,
  sharesTotal,
  type DepartmentShare,
} from "@/lib/stock/department-shares";

type Row = { participates: boolean; share: string };

function parseShare(s: string): number {
  if (!/^\d+(?:[.,]\d+)?$/.test(s.trim()))
    throw new Error("Укажите долю числом");
  return Number(s.trim().replace(",", "."));
}

function ShortageForm({
  initial,
  departmentId,
  onSaved,
}: {
  initial: StockRuleData;
  departmentId: string;
  onSaved: (d: StockRuleData) => void;
}) {
  const router = useRouter();
  const base = initial.draft;
  // Архивные подразделения показываем, только если они уже участвуют в правилах.
  const visible = useMemo(() => {
    const used = new Set([
      ...base.groups.flatMap((g) => g.departmentIds ?? []),
      ...(base.excludedDepartmentIds ?? []),
    ]);
    return initial.departments.filter(
      (d) => !d.archived_at || used.has(d.id) || d.id === departmentId,
    );
  }, [initial.departments, base, departmentId]);
  const initialRows = useMemo(() => {
    const shares = sharesFromRules(
      base,
      visible.map((d) => d.id),
    );
    return Object.fromEntries(
      shares.map((s) => [
        s.departmentId,
        { participates: s.participates, share: String(s.share) } as Row,
      ]),
    );
  }, [base, visible]);
  const [rows, setRows] = useState<Record<string, Row>>(initialRows);
  const [from, setFrom] = useState(
    initial.versions[0]?.valid_from &&
      initial.versions[0].valid_from > initial.today
      ? initial.versions[0].valid_from
      : initial.today,
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const multi = multiDepartmentGroupExists(base);
  const readOnly = !initial.canEdit || multi;
  const dirty = visible.some((d) => {
    const a = rows[d.id],
      b = initialRows[d.id];
    return (
      a.participates !== b.participates ||
      (a.participates && Number(a.share.replace(",", ".")) !== Number(b.share))
    );
  });
  const names = useMemo(
    () => new Map(initial.departments.map((d) => [d.id, d.name])),
    [initial.departments],
  );
  const total = sharesTotal(
    visible.map((d) => ({
      departmentId: d.id,
      participates: rows[d.id].participates,
      share: Number(rows[d.id].share.replace(",", ".")) || 0,
    })),
  );
  const patch = (id: string, p: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));
  const own = rows[departmentId];

  async function save() {
    setBusy(true);
    try {
      if (!reason.trim()) throw new Error("Укажите основание изменения");
      const shares: DepartmentShare[] = visible.map((d) => ({
        departmentId: d.id,
        participates: rows[d.id].participates,
        share: rows[d.id].participates ? parseShare(rows[d.id].share) : 0,
      }));
      const next = deductionRulesSchema.parse({
        ...rulesWithShares(base, shares, names),
        split: "once",
        multiplier: 1,
        distribution: "departments",
      });
      const d = await saveStockRules({
        venueId: initial.venueId,
        expectedVersion: initial.versions[0]?.version ?? 0,
        validFrom: from,
        config: next,
        reason,
      });
      onSaved(d.data);
      router.refresh();
      toast.success("Доли сохранены");
      if (d.deductionNotice) toast.message(d.deductionNotice);
    } catch (e) {
      toast.error(
        e instanceof z.ZodError
          ? e.issues[0]?.message
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить доли",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 border-t pt-5">
      <h2 className="text-lg font-semibold">Недостача</h2>
      {multi && (
        <p role="alert" className="text-sm text-destructive">
          Группа объединяет несколько подразделений. Разделите её в настройках
          заведения.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Switch
            id="shortage-participates"
            checked={own.participates}
            disabled={readOnly || busy}
            onCheckedChange={(v) => patch(departmentId, { participates: v })}
          />
          <Label htmlFor="shortage-participates">
            Участвует в общей недостаче
          </Label>
        </div>
        {own.participates && (
          <div className="flex items-center gap-2">
            <Label htmlFor="shortage-share" className="text-[13px]">
              Доля, %
            </Label>
            <Input
              id="shortage-share"
              inputMode="decimal"
              value={own.share}
              disabled={readOnly || busy}
              onChange={(e) => patch(departmentId, { share: e.target.value })}
              className="w-24 text-right"
            />
          </div>
        )}
      </div>
      {dirty && !readOnly && (
        <div className="space-y-4">
          <div className="divide-y rounded-lg border">
            {visible.map((d) => (
              <div
                key={d.id}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5"
              >
                <span
                  className={`min-w-0 truncate text-sm ${
                    d.id === departmentId ? "font-medium" : ""
                  }`}
                >
                  {d.name}
                  {d.archived_at ? " · в архиве" : ""}
                </span>
                <Switch
                  aria-label={`${d.name}: участвует`}
                  checked={rows[d.id].participates}
                  disabled={busy}
                  onCheckedChange={(v) => patch(d.id, { participates: v })}
                />
                <Input
                  aria-label={`Доля ${d.name}, %`}
                  inputMode="decimal"
                  value={rows[d.id].participates ? rows[d.id].share : ""}
                  disabled={busy || !rows[d.id].participates}
                  onChange={(e) => patch(d.id, { share: e.target.value })}
                  className="w-20 text-right"
                />
              </div>
            ))}
          </div>
          <p
            className={`text-sm ${
              Math.abs(total - 100) > 0.000001
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            Всего {total.toLocaleString("ru-RU")} из 100%
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shortage-valid-from">Применять с</Label>
              <DatePicker
                id="shortage-valid-from"
                value={from}
                onChange={setFrom}
                clearable={false}
                fromDate={new Date(`${initial.today}T00:00:00`)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shortage-reason">Основание изменения</Label>
              <Input
                id="shortage-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например, изменили доли подразделений"
                maxLength={1000}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function DepartmentShortageBlock({
  rules,
  departmentId,
}: {
  rules: StockRuleData | null;
  departmentId: string;
}) {
  const [data, setData] = useState(rules);
  if (!data) return null;
  return (
    <ShortageForm
      key={`${data.venueId}:${data.versions[0]?.version ?? 0}`}
      initial={data}
      departmentId={departmentId}
      onSaved={setData}
    />
  );
}

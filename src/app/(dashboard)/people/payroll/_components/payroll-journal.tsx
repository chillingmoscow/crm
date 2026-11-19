"use client";

import { PayrollEmployeePicker } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-picker";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Plus,
  Camera,
  MessageCircle,
  Trash2,
  AlertTriangle,
  Gift,
  Coins,
  Pencil,
  MoreHorizontal,
  X,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PayrollMonthPicker } from "@/app/(dashboard)/people/payroll/_components/payroll-month-picker";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PayrollDetailDialog } from "@/app/(dashboard)/people/payroll/_components/payroll-detail-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PayrollEmployeeCell } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-cell";
import { PayrollTable } from "@/app/(dashboard)/people/payroll/_components/payroll-table";
import { TableFilterChip } from "@/components/shared/table";
import {
  createPayrollEntry,
  recordPayrollBonuses,
  updatePayrollEntry,
  deletePayrollEntry,
  commentPayrollEntry,
  loadPayrollEntry,
  uploadPayrollPhoto,
  type PayrollEntryDetail,
} from "@/app/(dashboard)/people/payroll/journal-actions";
import type { Adjustment, PayrollData } from "@/lib/payroll/types";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { zonedParts } from "@/lib/sales/time";
import { formatQuantityAmount, signedAmountClass } from "@/lib/format/amount";
import { Money, formatRub } from "@/components/shared/money";
import { StatusBadge } from "@/components/ui/status-badge";
import style from "./payroll-journal.module.css";
import formStyle from "./payroll-payment-form.module.css";

const kindLabels: Record<string, string> = {
  allowance: "Надбавка за месяц",
  bonus: "Премия",
  deduction: "Штраф",
  // Удержание по недостаче, которое ставит расчёт инвентаризации (origin inventory_deduction).
  inventory: "Недостача",
  warning: "Предупреждение",
  food: "Питание",
  correction: "Корректировка",
  knowledge: "Знания",
  experience: "Стаж",
};
/** Что удаляем — для заголовка и кнопки подтверждения («Удалить штраф»). */
const deleteObjects: Record<string, string> = {
  allowance: "надбавку",
  bonus: "премию",
  deduction: "штраф",
  inventory: "удержание за недостачу",
  warning: "предупреждение",
  correction: "корректировку",
};
const labels = {
  date: "Дата",
  employee: "Сотрудник",
  kind: "Тип",
  reason: "Основание",
  amount: "Сумма",
};
/** Бонусы Quick Resto — баллы, не рубли: «+150 б.», «−20 б.». */
const bonusPoints = (n: number, signed = true) =>
  `${signed ? (n > 0 ? "+" : n < 0 ? "−" : "") : n < 0 ? "−" : ""}${formatQuantityAmount(Math.abs(n), 2)} б.`;
const dateLabel = (d: string) => d.slice(0, 10).split("-").reverse().join(".");
const statusLabel = (r: Adjustment) =>
  r.deleted_at
    ? "Удалено"
    : r.medium === "bonus"
      ? r.external_state === "done"
        ? "Учтено в бонусах"
        : r.origin === "lateness" && r.external_state === "review"
          ? "Нужен бонусный баланс"
          : "Рассчитано · бонусы"
      : r.kind === "warning"
        ? "Учтено"
        : r.approved
          ? "Учтено в зарплате"
          : "Прежняя запись";
/** Сумма записи со знаком; копейки — только в карточке записи (`fraction`). */
const entryAmount = (r: Adjustment, fraction = false): ReactNode => {
  if (r.kind === "warning") return <Money value={null} />;
  const value = Number(r.amount);
  if (r.medium === "bonus")
    return (
      <span className={`whitespace-nowrap tabular-nums ${signedAmountClass(value)}`}>
        {bonusPoints(value)}
      </span>
    );
  return <Money value={value} signed fraction={fraction} />;
};
/** То же строкой — для удалённой записи, которая показывается серой и зачёркнутой. */
const entryAmountText = (r: Adjustment) =>
  r.kind === "warning"
    ? "—"
    : r.medium === "bonus"
      ? bonusPoints(Number(r.amount))
      : formatRub(Number(r.amount), { signed: true });


export function PayrollEntryMenuItems({onSelect}: {onSelect:(kind:"deduction" | "allowance")=>void}) {
  return <><DropdownMenuItem onSelect={() => onSelect("deduction")}>Премия / штраф</DropdownMenuItem><DropdownMenuItem onSelect={() => onSelect("allowance")}>Надбавка за месяц</DropdownMenuItem></>;
}

export function PayrollJournal({
  data,
  month,
  query,
  onQuery,
  onChange,
  actions,
  toolbarTargetId = "payroll-workspace-controls",
  employeeId,
}: {
  data: PayrollData;
  month: string;
  query: string;
  onQuery: (q: string) => void;
  onChange: () => Promise<void>;
  actions?: ReactNode;
  toolbarTargetId?: string;
  employeeId?: string;
}) {
  const [kind, setKind] = useState("all"),
    [employee, setEmployee] = useState("all"),
    [showDeleted, setShowDeleted] = useState(false);
  const [createKind, setCreateKind] = useState<"deduction" | "allowance">("deduction");
  const [creating, setCreating] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayrollEntryDetail | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [comment, setComment] = useState(""),
    [deleting, setDeleting] = useState(false),
    [deleteReason, setDeleteReason] = useState(""),
    [deleteError, setDeleteError] = useState("");
  const [photoPreview, setPhotoPreview] = useState<{url:string;name:string} | null>(null);
  const [editing, setEditing] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editExpected, setEditExpected] = useState({amount:0,reason:""});
  const [detailTab, setDetailTab] = useState("details");
  const selection = useRef(selectedId);
  selection.current = selectedId;
  const selected = data.adjustments.find((a) => a.id === selectedId);
  const paidBonuses = useMemo(() => new Set(
    data.payments.flatMap((payment) =>
      payment.state === "posted" && payment.bonus_adjustment_id
        ? [payment.bonus_adjustment_id]
        : [],
    ),
  ), [data.payments]);
  const selectedPaid = !!selected && paidBonuses.has(selected.id);
  const canWrite = data.permissions.includes("payroll.review");
  const reloadDetail = async () => {
    if (!selectedId) return;
    const next = await loadPayrollEntry(selectedId);
    if (selection.current === selectedId) setDetail(next);
  };
  useEffect(() => {
    setDetail(null);
    setError("");
    setComment("");
    setDeleting(false);
    setEditing(false);
    setDetailTab("details");
    if (!selectedId) return;
    let live = true;
    const load = () =>
      loadPayrollEntry(selectedId)
        .then((d) => {
          if (live) {
            setDetail(d);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selectedId]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("entry");
    if (id && data.adjustments.some((a) => a.id === id)) setSelectedId(id);
  }, [data.adjustments]);
  const rows = data.adjustments.filter(
    (a) =>
      a.business_date.startsWith(month.slice(0, 7)) &&
      (!employeeId || a.employee_id === employeeId) &&
      (employee === "all" || a.employee_id === employee) &&
      (kind === "all" || a.kind === kind) &&
      (showDeleted || !a.deleted_at),
  );
  const columns = useMemo<ColumnDef<Adjustment>[]>(
    () =>
      Object.entries(labels).map(([id, label]) => ({
        id,
        header: label,
        accessorFn: (r) =>
          id === "date"
            ? r.business_date
            : id === "employee"
              ? (data.employees.find((e) => e.id === r.employee_id)?.name ??
                "Сотрудник")
              : id === "kind"
                ? (kindLabels[r.kind] ?? r.kind)
                : id === "status"
                  ? statusLabel(r)
                  : r[id as "amount" | "reason"],
        cell: ({ row }) => {
          const r = row.original;
          if (id === "date") return r.kind === "allowance" ? new Date(`${r.business_date}T12:00:00Z`).toLocaleDateString("ru-RU", {month:"long",year:"numeric",timeZone:"UTC"}) : dateLabel(r.business_date);
          if (id === "employee") {
            const e = data.employees.find((e) => e.id === r.employee_id);
            return (
              <PayrollEmployeeCell name={e?.name ?? "Сотрудник"} role={e?.role_name} avatarUrl={e?.avatar_url} />
            );
          }
          if (id === "kind")
            return (
              <span className={style.kind}>
                {r.kind === "warning" ? (
                  <AlertTriangle size={14} />
                ) : r.kind === "bonus" ? (
                  <Gift size={14} />
                ) : (
                  <Coins size={14} />
                )}{" "}
                {kindLabels[r.kind] ?? r.kind}
                {paidBonuses.has(r.id) && <StatusBadge tone="success">Выплачена</StatusBadge>}
              </span>
            );
          if (id === "amount")
            return r.deleted_at ? (
              <span className={`${style.deleted} whitespace-nowrap tabular-nums`}>
                {entryAmountText(r)}
              </span>
            ) : (
              entryAmount(r)
            );
          if (r.deleted_at) return <span className="flex min-w-0 items-center gap-2"><span className="line-clamp-2 min-w-0 text-muted-foreground line-through" data-tip={r.reason}>{r.reason}</span><StatusBadge className="shrink-0">Удалено</StatusBadge></span>;
          return <span className="line-clamp-2" data-tip={r.reason}>{r.reason}</span>;
        },
      })),
    [data.employees, paidBonuses],
  );
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };
  // Удаление записи — только через диалог с причиной; ошибка сервера остаётся в диалоге.
  const deleteObject = selected ? (deleteObjects[selected.kind] ?? "запись") : "запись";
  const confirmDelete = async () => {
    if (!selected) return;
    setBusy(true);
    setDeleteError("");
    try {
      await deletePayrollEntry(selected.id, deleteReason);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Не удалось удалить запись");
      setBusy(false);
      return;
    }
    setDeleting(false);
    toast.success("Запись удалена");
    try {
      await onChange();
      await reloadDetail();
    } catch {
      // Список обновится при следующем автообновлении.
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PayrollTable
        // Ключ сохранённых настроек столбцов: остался от прежнего названия
        // экрана, менять нельзя — у всех сбросятся порядок и ширина столбцов.
        id={
          employeeId
            ? `payroll-employee-journal-${employeeId}`
            : "payroll-concept-journal"
        }
        label="Начисления и удержания"
        rows={rows}
        columns={columns}
        labels={labels}
        numeric={["amount"]}
        defaultSort="date"
        defaultSortDesc
        toolbarTargetId={toolbarTargetId}
        externalSearch={{ value: query, onChange: onQuery }}
        searchText={(r) =>
          `${data.employees.find((e) => e.id === r.employee_id)?.name} ${r.reason} ${kindLabels[r.kind]}`
        }
        onRow={(r) => setSelectedId(r.id)}
        actions={
          <>
            {actions}
            {canWrite && (
              <DropdownMenu><DropdownMenuTrigger asChild><Button><Plus size={15}/>Добавить запись</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><PayrollEntryMenuItems onSelect={(kind) => {setCreateKind(kind);setCreating(true);}}/></DropdownMenuContent></DropdownMenu>
            )}
          </>
        }
        filters={{
          active: kind !== "all" || employee !== "all" || showDeleted,
          onReset: () => {
            setKind("all");
            setEmployee("all");
            setShowDeleted(false);
          },
          chips: (
            <>
              {!employeeId && (
                <TableFilterChip
                  label="Сотрудник"
                  value={employee === "all" ? "" : employee}
                  onChange={(v) => setEmployee(v || "all")}
                  options={[
                    { value: "", label: "Все сотрудники" },
                    ...data.employees.map((e) => ({ value: e.id, label: e.name })),
                  ]}
                />
              )}
              <TableFilterChip
                label="Тип записи"
                value={kind === "all" ? "" : kind}
                onChange={(v) => setKind(v || "all")}
                options={[
                  { value: "", label: "Все записи" },
                  ...Object.entries(kindLabels).map(([id, name]) => ({
                    value: id,
                    label: name,
                  })),
                ]}
              />
              <TableFilterChip
                label="Удалённые"
                value={showDeleted ? "shown" : ""}
                onChange={(v) => setShowDeleted(v === "shown")}
                options={[
                  { value: "", label: "Скрывать удалённые" },
                  { value: "shown", label: "Показывать удалённые" },
                ]}
              />
            </>
          ),
        }}
      />
      <PayrollEntryForm
        initialKind={createKind}
        open={creating}
        onOpenChange={setCreating}
        data={data}
        month={month}
        employeeId={employeeId}
        onCreated={async (ids) => {
          await onChange();
          if (ids.length === 1) setSelectedId(ids[0]);
        }}
      />
      <PayrollDetailDialog
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open && !busy) setSelectedId(null); }}
        title={selected ? (kindLabels[selected.kind] ?? "Запись") : "Запись"}
        description={selected ? selected.kind === "allowance" ? new Date(`${selected.business_date}T12:00:00Z`).toLocaleDateString("ru-RU", {month:"long",year:"numeric",timeZone:"UTC"}) : dateLabel(selected.business_date) : ""}
        employee={selected ? (() => { const e = data.employees.find((e) => e.id === selected.employee_id); return {name:e?.name ?? "Сотрудник", role:e?.role_name, avatarUrl:e?.avatar_url}; })() : undefined}
        amount={selected ? entryAmount(selected, true) : undefined}
        amountLabel={selected?.kind === "warning" ? "Без денежного удержания" : selected?.kind === "allowance" ? "Надбавка за месяц" : selected?.kind === "bonus" ? "Сумма премии" : selected?.kind === "correction" ? "Сумма корректировки" : "Сумма удержания"}
        status={selected && (selected.deleted_at || selectedPaid || detail?.notification) ? <span className="flex flex-wrap items-center justify-end gap-2">
          {selected.deleted_at && <StatusBadge>Удалено</StatusBadge>}
          {selectedPaid && <StatusBadge tone="success">Выплачена</StatusBadge>}
          {!selected.deleted_at && detail?.notification && <span
            className="inline-flex"
            data-tip={detail.notification.last_error ?? undefined}
          ><StatusBadge tone="warning">{detail.notification.final ? "Не будет отправлено" : "Не отправлено в чат"}</StatusBadge></span>}
        </span> : undefined}
        actions={canWrite && selected && !selected.deleted_at ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={busy} aria-label="Действия с записью"><MoreHorizontal size={18}/></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {["bonus","deduction","warning","allowance"].includes(selected.kind) && <DropdownMenuItem onSelect={() => {
                setDeleting(false); setEditing(true); setDetailTab("details");
                setEditAmount(String(Math.abs(Number(selected.amount)))); setEditReason(selected.reason);
                setEditExpected({amount:Number(selected.amount),reason:selected.reason});
              }}><Pencil size={15} className="mr-2"/>Изменить</DropdownMenuItem>}
              {!selectedPaid && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => {setEditing(false);setDeleteReason("");setDeleteError("");setDeleting(true);}}><Trash2 size={15} className="mr-2"/>Удалить запись</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined}
      >
        {selected && (
          <div className="space-y-6">
            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList>
                <TabsTrigger value="details">Детали</TabsTrigger>
                <TabsTrigger value="comments">
                  Комментарии{" "}
                  {detail?.comments.length ? `· ${detail.comments.length}` : ""}
                </TabsTrigger>
                <TabsTrigger value="history">История</TabsTrigger>
              </TabsList>
              {error && (
                <p className="mt-4 text-sm text-destructive">{error}</p>
              )}
              {!detail && !error && (
                <p className="mt-4 text-sm text-muted-foreground">Загружаем…</p>
              )}
              <TabsContent value="details" className="space-y-4">
                {selectedPaid && canWrite && <p className="text-xs text-muted-foreground">
                  Чтобы изменить сумму или удалить премию, сначала отмените её в разделе «Выплаты».
                </p>}
                {editing ? <div className="space-y-4">
                  {selected.kind !== "warning" && <div className="space-y-2"><Label htmlFor="edit-payroll-amount">Сумма, {selected.medium === "bonus" ? "б." : "₽"}</Label><Input id="edit-payroll-amount" inputMode="decimal" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} disabled={busy || selectedPaid || selected.external_state === "done" && selected.medium === "bonus"}/></div>}
                  <div className="space-y-2"><Label htmlFor="edit-payroll-reason">Основание</Label><Textarea id="edit-payroll-reason" value={editReason} onChange={(e) => setEditReason(e.target.value)} maxLength={4000} disabled={busy}/></div>
                  <div className="flex gap-2"><Button size="sm" disabled={busy || editReason.trim().length < 3 || (selected.kind !== "warning" && !(Number(editAmount.replace(/\s/g, "").replace(",", ".")) > 0))} onClick={() => void run(async () => {
                    await updatePayrollEntry({id:selected.id, amount:selected.kind === "warning" ? 0 : Number(editAmount.replace(/\s/g, "").replace(",", ".")), reason:editReason, expected_amount:editExpected.amount, expected_reason:editExpected.reason});
                    await onChange(); await reloadDetail(); setEditing(false); toast.success("Запись изменена");
                  })}>Сохранить</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Отмена</Button></div>
                </div> : <p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.reason}</p>}
            {selected.kind === "warning" && (
              <p className="text-sm text-muted-foreground">
                Предупреждений за месяц:{" "}
                {
                  data.adjustments.filter(
                    (a) =>
                      a.employee_id === selected.employee_id &&
                      a.business_date.slice(0, 7) ===
                        selected.business_date.slice(0, 7) &&
                      a.kind === "warning" &&
                      !a.deleted_at,
                  ).length
                }
              </p>
            )}
            {selected.medium === "bonus" &&
              selected.external_state !== "done" && (
                <p className={style.parallel}>
                  Результат бонусной операции ещё не подтверждён.
                  Изменения состояния бонусной операции сохраняются в истории записи.
                </p>
              )}
                <section className="space-y-3 border-t pt-4">{Boolean(detail?.photos.length) && <h3 className="text-xs font-medium text-muted-foreground">Фотографии</h3>}

                <div className={detail?.photos.length ? style.photos : undefined}>
                  {detail?.photos.map((p) => (
                    <button type="button" key={p.id} aria-label={`Открыть фотографию ${p.name}`} onClick={() => setPhotoPreview(p)}>
                      <Image
                        src={p.url}
                        alt={p.name}
                        width={150}
                        height={150}
                        unoptimized
                      />
                    </button>
                  ))}
                {canWrite && !selected.deleted_at && (
                  <label className={`${style.upload} ${detail?.photos.length ? style.addPhoto : ""}`}>
                    {detail?.photos.length ? <Plus size={24} /> : <><Camera size={17} />Прикрепить фотографию</>}
                    <input
                      type="file"
                      aria-label="Прикрепить фотографию"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          void run(async () => {
                            const form = new FormData();
                            form.set("file", f);
                            await uploadPayrollPhoto(selected.id, form);
                            await reloadDetail();
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                </div>
                </section>
              </TabsContent>
              <TabsContent value="history" className="space-y-2">
                {detail?.history.map((h) => (
                  <div className={style.history} key={h.id}>
                    <span className={style.historyDot} />
                    <div>
                      <p>
                        <strong>{h.actor_name}</strong> ·{" "}
                        {{
                          created: "Создана запись",
                          imported: "Добавлена из прежнего учёта",
                          deleted: "Удалена запись",
                          updated: "Изменена запись",
                          commented: "Добавлен комментарий",
                          photo_added: "Добавлена фотография",
                          bonus_operation: "Обработка бонусной операции",
                        }[h.action] ?? h.action}
                      </p>
                      {h.action === "bonus_operation" && <p className="text-muted-foreground">{({pending:"В очереди",reading:"Проверка баланса",sending:"Отправлена в Quick Resto",done:"Проведена",review:"Нужна сверка",cancelled:"Отменена",money:"Удержано деньгами"} as Record<string,string>)[String(h.details.state)]??"Нужна сверка"}{h.details.message?` · ${String(h.details.message)}`:""}</p>}
                      {h.action === "updated" && h.details.previous_amount != null && Number(h.details.previous_amount) !== Number(h.details.amount) && <p className="text-muted-foreground">Сумма: {h.details.medium === "bonus" ? `${bonusPoints(Number(h.details.previous_amount), false)} → ${bonusPoints(Number(h.details.amount), false)}` : `${formatRub(Number(h.details.previous_amount), { fraction: true })} → ${formatRub(Number(h.details.amount), { fraction: true })}`}</p>}
                      {h.action === "updated" && typeof h.details.previous_reason === "string" && h.details.previous_reason !== h.details.reason && <p className="text-muted-foreground">Основание: {h.details.previous_reason} → {String(h.details.reason)}</p>}
                      {h.details.delete_reason ? (
                        <p>{String(h.details.delete_reason)}</p>
                      ) : null}
                      <time>
                        {new Date(h.created_at).toLocaleString("ru-RU", {
                          timeZone: data.timezone,
                          ...(h.details.source_precision === "day" ? { dateStyle: "short" as const } : {}),
                        })}
                      </time>
                    </div>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="comments" className="space-y-5">
                {detail?.comments.map((c) => (
                  <div key={c.id} className={style.comment}>
                    <div>
                      <strong>{c.author_name}</strong>
                      <time>
                        {new Date(c.created_at).toLocaleString("ru-RU", {
                          timeZone: data.timezone,
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </time>
                    </div>
                    <p>{c.body}</p>
                  </div>
                ))}
                {detail && !detail.comments.length && (
                  <p className="text-sm text-muted-foreground">
                    Пока без комментариев
                  </p>
                )}
                {!selected.deleted_at && (
                  <div className="space-y-3">
                    <Textarea
                      aria-label="Комментарий к записи"
                      placeholder="Напишите комментарий"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      maxLength={4000}
                    />
                    <Button
                      disabled={busy || !comment.trim()}
                      onClick={() =>
                        void run(async () => {
                          await commentPayrollEntry(
                            selected.id,
                            comment,
                            crypto.randomUUID(),
                          );
                          setComment("");
                          await reloadDetail();
                        })
                      }
                    >
                      <MessageCircle size={15} />
                      Отправить
                    </Button>
                  </div>
                )}
              </TabsContent>

            </Tabs>
          </div>
        )}
      </PayrollDetailDialog>
      <ConfirmDialog
        open={deleting && Boolean(selected)}
        onOpenChange={(open) => { if (!open) setDeleting(false); }}
        title={`Удалить ${deleteObject}?`}
        description="Запись перестанет учитываться и останется в журнале с отметкой «Удалено»: её видно с фильтром «Показывать удалённые». Причина сохранится в истории записи."
        confirmLabel={`Удалить ${deleteObject}`}
        pendingLabel="Удаляем…"
        destructive
        busy={busy}
        confirmDisabled={deleteReason.trim().length < 3}
        onConfirm={() => void confirmDelete()}
      >
        <div className="space-y-2">
          <Label htmlFor="delete-entry-reason">Причина удаления</Label>
          <Textarea
            id="delete-entry-reason"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            maxLength={1000}
            disabled={busy}
          />
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
        </div>
      </ConfirmDialog>
      <Dialog open={Boolean(photoPreview)} onOpenChange={(open) => {if (!open) setPhotoPreview(null);}}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="pr-8 text-base">Фотография</DialogTitle>
          <DialogDescription className="sr-only">Просмотр прикреплённой фотографии</DialogDescription>
          {photoPreview && <Image src={photoPreview.url} alt={photoPreview.name} width={1200} height={900} unoptimized className="max-h-[75dvh] w-full rounded-lg object-contain"/>}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PayrollEntryForm({
  open,
  onOpenChange,
  data,
  month,
  employeeId,
  initialKind = "deduction",
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: PayrollData;
  month: string;
  employeeId?: string;
  initialKind?: "deduction" | "allowance";
  onCreated: (ids: string[]) => Promise<void>;
}) {
  const [kind, setKind] = useState<"bonus" | "deduction" | "warning" | "allowance">(initialKind),
    [medium, setMedium] = useState<"money" | "bonus">("money"),
    [employee, setEmployee] = useState(employeeId ?? ""),
    [date, setDate] = useState(month),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [payNow, setPayNow] = useState(false);
  const [bank, setBank] = useState("");
  const [payoutDate, setPayoutDate] = useState("");
  const request = useRef<{ key: string; payload: string } | null>(null);
  const submitting = useRef(false);
  const employees = data.employees.filter((e) => e.active);
  const isBonus = kind === "bonus";
  const selected = employees.filter((e) => Object.hasOwn(amounts, e.id));
  const total = selected.reduce((sum, e) => sum + (Number(amounts[e.id]) || 0), 0);
  const canPayNow = isBonus && medium === "money"
    && data.permissions.includes("payroll.pay")
    && data.permissions.includes("finance.create_transaction");
  const issuing = canPayNow && payNow;
  const valid = !!date && reason.trim().length >= 3 && (isBonus
    ? selected.length > 0 && selected.every((e) => {
      const value = Number(amounts[e.id]);
      return value > 0 && value <= 1e9
        && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
        && (!issuing || !!e.role_id);
    }) && (!issuing || (!!bank && !!payoutDate))
    : !!employee && (kind === "warning" || Number(amount) > 0));

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setMedium("money");
      request.current = null;
      setDate(month);
      setEmployee(employeeId ?? "");
      setAmount("");
      setAmounts(employeeId ? { [employeeId]: "" } : {});
      setReason("");
      setFiles([]);
      setPayNow(false);
      setBank("");
      setPayoutDate(zonedParts(new Date(), data.timezone).date);
    }
  }, [open, month, employeeId, initialKind, data.timezone]);

  const changeRecipients = (ids: string[]) =>
    setAmounts((previous) =>
      Object.fromEntries(ids.map((id) => [id, previous[id] ?? ""])),
    );
  const submit = async () => {
    if (submitting.current || !valid) return;
    submitting.current = true;
    setBusy(true);
    try {
      const shared = { date, reason: reason.trim() };
      const bonus = {
        ...shared,
        medium,
        recipients: selected.map((e) => ({ employee_id: e.id, amount: Number(amounts[e.id]) })),
        ...(issuing ? { bank_account_id: bank, payout_date: payoutDate } : {}),
      };
      const single = {
        ...shared, kind, employee_id: employee,
        medium: kind === "warning" ? "none" as const : kind === "allowance" ? "money" as const : medium,
        amount: kind === "warning" ? 0 : Number(amount),
      };
      const payload = JSON.stringify(isBonus ? bonus : single);
      if (request.current?.payload !== payload)
        request.current = { key: crypto.randomUUID(), payload };
      const key = request.current.key;
      const ids = isBonus
        ? await recordPayrollBonuses({ ...bonus, request_key: key })
        : [await createPayrollEntry({ ...single, id: key, request_key: key })];
      let photoError = false;
      await runWithConcurrency(ids.flatMap((id) => files.map((file) => ({ id, file }))), 3, async ({ id, file }) => {
        try {
          const f = new FormData();
          f.set("file", file);
          await uploadPayrollPhoto(id, f);
        } catch {
          photoError = true;
        }
      });
      onOpenChange(false);
      if (photoError)
        toast.error(
          "Данные сохранены. Часть фото не загрузилась. Их можно прикрепить в карточках.",
        );
      else toast.success(isBonus
        ? issuing ? "Премии начислены и выплачены" : "Премии начислены"
        : "Запись добавлена");
      try {
        await onCreated(ids);
      } catch {
        toast.error("Данные сохранены. Обновите страницу, чтобы увидеть изменения.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <PayrollDetailDialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
      title={kind === "allowance" ? "Надбавка за месяц" : kind === "bonus" ? "Добавить премию" : kind === "warning" ? "Добавить предупреждение" : "Добавить штраф"}
      description="Учитывается в расчёте зарплаты"
      footer={
        <div className={`${formStyle.footer} ${formStyle.totalRow}`}>
          {isBonus && <div aria-live="polite">
            <span>Итого</span>
            <strong>{medium === "money" ? <Money value={total} fraction={!Number.isInteger(total)} /> : <>{formatQuantityAmount(total, 2)} <small>б.</small></>}</strong>
          </div>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button disabled={busy || !valid} onClick={() => void submit()}>
              {busy ? "Сохраняем…" : issuing ? "Начислить и выдать" : isBonus ? "Начислить" : "Добавить"}
            </Button>
          </div>
        </div>
      }
    >
      <form
        className={formStyle.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {initialKind !== "allowance" && <div className={style.segment}>
          {[
            ["deduction", "Штраф"],
            ["bonus", "Премия"],
            ["warning", "Предупреждение"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              disabled={busy}
              onClick={() => {
                if (id === kind) return;
                setKind(id === "bonus" || id === "warning" ? id : "deduction");
                setPayNow(false);
                if (id === "bonus" && employee && !selected.length) changeRecipients([employee]);
              }}
            >
              {label}
            </button>
          ))}
        </div>}
        {isBonus ? (
          <section className={formStyle.recipients} aria-label="Получатели премии">
            <div className={formStyle.recipientHeading}>
              <h3>Кому начисляем {selected.length > 0 && <span>{selected.length}</span>}</h3>
            </div>
            <PayrollEmployeePicker employees={employees} selectedIds={Object.keys(amounts)} multiple disabled={busy} onChange={changeRecipients} />
            {selected.length > 0 && <div className={formStyle.selectedPeople}>
              {selected.map((e) => (
                <div key={e.id} className={formStyle.person}>
                  <div className={formStyle.identity}>
                    <PayrollEmployeeCell name={e.name} role={e.role_name} avatarUrl={e.avatar_url} />
                    {issuing && !e.role_id && <small className="text-destructive">Укажите должность сотрудника</small>}
                  </div>
                  <div className={formStyle.amountInput}>
                    <Input type="number" inputMode="decimal" min="0.01" step="0.01" max="1000000000"
                      aria-label={`Премия для ${e.name}`} placeholder="0" value={amounts[e.id]} disabled={busy}
                      onChange={(event) => setAmounts((prev) => ({ ...prev, [e.id]: event.target.value }))} />
                    <span>{medium === "money" ? "₽" : "б."}</span>
                  </div>
                  <button type="button" className={`${formStyle.removePerson} touch-target`} aria-label={`Убрать ${e.name}`}
                    disabled={busy} onClick={() => changeRecipients(Object.keys(amounts).filter((id) => id !== e.id))}>
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>}
          </section>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="entry-employee">Сотрудник</Label>
            <PayrollEmployeePicker id="entry-employee" employees={employees} selectedIds={employee ? [employee] : []} disabled={busy} onChange={(ids) => setEmployee(ids[0] ?? "")} />
          </div>
        )}
        <div className={formStyle.fields}>
          <div>
            <Label htmlFor="entry-date">{kind === "allowance" ? "Месяц начисления" : isBonus ? "Дата начисления" : "Дата"}</Label>
            {kind === "allowance" ? <PayrollMonthPicker variant="field" ariaLabel="Месяц надбавки" prefix="" value={date} min={data.settings?.starts_on ?? month} disabled={busy} onChange={setDate}/> : <DatePicker id="entry-date" value={date} onChange={setDate} clearable={false} disabled={busy}/>}

          </div>
          {kind !== "warning" && kind !== "allowance" && (
            <div>
              <Label htmlFor="entry-medium">Начисление</Label>
              <Select value={medium} disabled={busy} onValueChange={(value) => {
                setMedium(value === "bonus" ? "bonus" : "money");
                setPayNow(false);
              }}>
                <SelectTrigger id="entry-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="money">Деньги, ₽</SelectItem>
                  <SelectItem value="bonus">Бонусы</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {canPayNow && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Switch id="entry-pay-now" checked={payNow} disabled={busy} onCheckedChange={setPayNow} />
              <Label htmlFor="entry-pay-now">Сразу выдать премию</Label>
            </div>
            {issuing && (
              <div className={formStyle.fields}>
                <div>
                  <Label htmlFor="entry-bank">Счёт списания</Label>
                  <Select value={bank} onValueChange={setBank} disabled={busy}>
                    <SelectTrigger id="entry-bank" className={formStyle.select}><SelectValue placeholder="Выберите счёт" /></SelectTrigger>
                    <SelectContent>
                      {data.banks.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {!data.banks.length && <p className="text-xs text-muted-foreground">Нет доступных счетов</p>}
                </div>
                <div>
                  <Label htmlFor="entry-payout-date">Дата выплаты</Label>
                  <DatePicker id="entry-payout-date" value={payoutDate} onChange={setPayoutDate} clearable={false} disabled={busy} />
                </div>
              </div>
            )}
          </div>
        )}
        {kind !== "warning" && !isBonus && (
          <div className="space-y-2">
            <Label htmlFor="entry-amount">
              Сумма{medium === "money" ? ", ₽" : " бонусов"}
            </Label>
            <Input
              id="entry-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="entry-reason">Основание</Label>
          <Textarea
            id="entry-reason"
            placeholder={kind === "allowance" ? "Например, KPI старшего мастера за месяц" : "Что произошло"}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            maxLength={4000}
          />
        </div>
        <label className={style.upload}>
          <Camera size={17} />
          {files.length
            ? `Фотографий: ${files.length}`
            : "Прикрепить фотографии"}
          <input
            type="file"
            disabled={busy}
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) =>
              setFiles(Array.from(e.target.files ?? []).slice(0, 6))
            }
          />
        </label>
        {isBonus && selected.length > 1 && files.length > 0 && (
          <p className="text-xs text-muted-foreground">Фотографии будут приложены к каждой премии.</p>
        )}
        {kind !== "warning" && medium === "bonus" && (
          <p className={style.parallel}>
            Состояние бонусной операции появится в карточке записи.
          </p>
        )}
      </form>
    </PayrollDetailDialog>
  );
}

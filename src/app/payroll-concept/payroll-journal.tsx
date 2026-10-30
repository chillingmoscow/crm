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
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { PayrollEmployeeCell } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-cell";
import { PayrollTable } from "@/app/(dashboard)/people/payroll/_components/payroll-table";
import {
  createPayrollEntry,
  updatePayrollEntry,
  deletePayrollEntry,
  commentPayrollEntry,
  loadPayrollEntry,
  uploadPayrollPhoto,
  type PayrollEntryDetail,
} from "@/app/(dashboard)/people/payroll/journal-actions";
import type { Adjustment, PayrollData } from "@/lib/payroll/types";
import style from "./payroll-journal.module.css";
import formStyle from "./concept-payment-form.module.css";

const kindLabels: Record<string, string> = {
  allowance: "Надбавка за месяц",
  bonus: "Премия",
  deduction: "Штраф",
  warning: "Предупреждение",
  food: "Питание",
  correction: "Корректировка",
  knowledge: "Знания",
  experience: "Стаж",
};
const labels = {
  date: "Дата",
  employee: "Сотрудник",
  kind: "Тип",
  reason: "Основание",
  amount: "Сумма",
};
const format = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n);
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
const entryAmount = (r: Adjustment) =>
  r.kind === "warning"
    ? "—"
    : `${Number(r.amount) > 0 ? "+" : "−"}${format(Math.abs(Number(r.amount)))} ${r.medium === "bonus" ? "б." : "₽"}`;


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
  toolbarTargetId = "payroll-concept-controls",
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
    [deleteReason, setDeleteReason] = useState("");
  const [photoPreview, setPhotoPreview] = useState<{url:string;name:string} | null>(null);
  const [editing, setEditing] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editExpected, setEditExpected] = useState({amount:0,reason:""});
  const [detailTab, setDetailTab] = useState("details");
  const selection = useRef(selectedId);
  selection.current = selectedId;
  const selected = data.adjustments.find((a) => a.id === selectedId);
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
              </span>
            );
          if (id === "amount")
            return (
              <span
                className={
                  r.deleted_at
                    ? style.deleted
                    : Number(r.amount) < 0
                      ? style.negative
                      : style.positive
                }
              >
                {entryAmount(r)}
              </span>
            );
          if (r.deleted_at) return <span className="line-clamp-2 text-muted-foreground line-through" title={r.reason}>{r.reason} · Удалено</span>;
          return <span className="line-clamp-2" title={r.reason}>{r.reason}</span>;
        },
      })),
    [data.employees],
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
  return (
    <>
      <PayrollTable
        id={
          employeeId
            ? `payroll-employee-journal-${employeeId}`
            : "payroll-concept-journal"
        }
        rows={rows}
        columns={columns}
        labels={labels}
        numeric={["amount"]}
        defaultSort="date"
        defaultSortDesc
        scrollMode="page"
        toolbarTargetId={toolbarTargetId}
        externalSearch={{ value: query, onChange: onQuery }}
        searchText={(r) =>
          `${data.employees.find((e) => e.id === r.employee_id)?.name} ${r.reason} ${kindLabels[r.kind]}`
        }
        onRow={(r) => setSelectedId(r.id)}
        actions={
          <>
            {canWrite && (
              <DropdownMenu><DropdownMenuTrigger asChild><Button><Plus size={15}/>Добавить запись</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><PayrollEntryMenuItems onSelect={(kind) => {setCreateKind(kind);setCreating(true);}}/></DropdownMenuContent></DropdownMenu>
            )}
            {actions}
          </>
        }
        filters={{
          active: kind !== "all" || employee !== "all" || showDeleted,
          content: (
            <div className="space-y-4 p-1">
              <Label>Сотрудник</Label>
              <Select value={employee} onValueChange={setEmployee}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все сотрудники</SelectItem>
                  {data.employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Тип записи</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все записи</SelectItem>
                  {Object.entries(kindLabels).map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showDeleted}
                  onChange={(e) => setShowDeleted(e.target.checked)}
                />
                Показывать удалённые
              </label>
            </div>
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
        onCreated={async (id) => {
          await onChange();
          setSelectedId(id);
        }}
      />
      <PayrollDetailDialog
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open && !busy) setSelectedId(null); }}
        title={selected ? (kindLabels[selected.kind] ?? "Запись") : "Запись"}
        description={selected ? selected.kind === "allowance" ? new Date(`${selected.business_date}T12:00:00Z`).toLocaleDateString("ru-RU", {month:"long",year:"numeric",timeZone:"UTC"}) : dateLabel(selected.business_date) : ""}
        employee={selected ? (() => { const e = data.employees.find((e) => e.id === selected.employee_id); return {name:e?.name ?? "Сотрудник", role:e?.role_name, avatarUrl:e?.avatar_url}; })() : undefined}
        amount={selected ? entryAmount(selected) : undefined}
        amountLabel={selected?.kind === "warning" ? "Без денежного удержания" : selected?.kind === "allowance" ? "Надбавка за месяц" : selected?.kind === "bonus" ? "Сумма премии" : selected?.kind === "correction" ? "Сумма корректировки" : "Сумма удержания"}
        status={selected?.deleted_at ? <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Удалено</span> : undefined}
        actions={canWrite && selected && !selected.deleted_at ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={busy} aria-label="Действия с записью"><MoreHorizontal size={18}/></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {["bonus","deduction","warning","allowance"].includes(selected.kind) && <DropdownMenuItem onSelect={() => {
                setDeleting(false); setEditing(true); setDetailTab("details");
                setEditAmount(String(Math.abs(Number(selected.amount)))); setEditReason(selected.reason);
                setEditExpected({amount:Number(selected.amount),reason:selected.reason});
              }}><Pencil size={15} className="mr-2"/>Изменить</DropdownMenuItem>}
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => {setEditing(false);setDeleting(true);setDetailTab("details");}}><Trash2 size={15} className="mr-2"/>Удалить</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined}
      >
        {selected && (
          <div className="space-y-6">
            {deleting && (
              <div className="space-y-3 rounded-lg border p-4">
                <Label htmlFor="delete-entry-reason">Причина удаления</Label>
                <Textarea
                  id="delete-entry-reason"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                />
                <Button
                  variant="destructive"
                  disabled={busy || deleteReason.trim().length < 3}
                  onClick={() =>
                    void run(async () => {
                      await deletePayrollEntry(selected.id, deleteReason);
                      await onChange();
                      await reloadDetail();
                      setDeleting(false);
                      toast.success("Запись удалена");
                    })
                  }
                >
                  Удалить
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>Отмена</Button>
              </div>
            )}
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
                {editing ? <div className="space-y-4">
                  {selected.kind !== "warning" && <div className="space-y-2"><Label htmlFor="edit-payroll-amount">Сумма, {selected.medium === "bonus" ? "б." : "₽"}</Label><Input id="edit-payroll-amount" inputMode="decimal" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} disabled={busy || selected.external_state === "done" && selected.medium === "bonus"}/></div>}
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
                  Состояние и сверка — в разделе «Медкнижки и форма → Бонусы и переход».
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
                      {h.action === "updated" && h.details.previous_amount != null && Number(h.details.previous_amount) !== Number(h.details.amount) && <p className="text-muted-foreground">Сумма: {format(Number(h.details.previous_amount))} → {format(Number(h.details.amount))} {h.details.medium === "bonus" ? "б." : "₽"}</p>}
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
              <TabsContent value="comments" className="space-y-5 pt-4">
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
  onCreated: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<string>(initialKind),
    [medium, setMedium] = useState("money"),
    [employee, setEmployee] = useState(employeeId ?? ""),
    [date, setDate] = useState(month),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setMedium("money");
      setRequestKey(crypto.randomUUID());
      setDate(month);
      setEmployee(employeeId ?? "");
      setAmount("");
      setReason("");
      setFiles([]);
    }
  }, [open, month, employeeId, initialKind]);
  const submit = async () => {
    setBusy(true);
    try {
      const id = await createPayrollEntry({
        id: requestKey,
        request_key: requestKey,
        employee_id: employee,
        date,
        kind: kind as "bonus" | "deduction" | "warning" | "allowance",
        medium: kind === "warning" ? "none" : kind === "allowance" ? "money" : (medium as "money" | "bonus"),
        amount: kind === "warning" ? 0 : Number(amount),
        reason,
      });
      let photoError = false;
      for (const file of files) {
        try {
          const f = new FormData();
          f.set("file", file);
          await uploadPayrollPhoto(id, f);
        } catch {
          photoError = true;
        }
      }
      await onCreated(id);
      onOpenChange(false);
      if (photoError)
        toast.error(
          "Запись сохранена. Часть фото не загрузилась — прикрепите их в карточке.",
        );
      else toast.success("Запись добавлена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
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
        <Button
          className="ml-auto"
          disabled={
            busy ||
            !employee ||
            !date ||
            reason.trim().length < 3 ||
            (kind !== "warning" && !(Number(amount) > 0))
          }
          onClick={() => void submit()}
        >
          {busy ? "Сохраняем…" : "Добавить"}
        </Button>
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
              onClick={() => setKind(id)}
            >
              {label}
            </button>
          ))}
        </div>}
        <div className="space-y-2">
          <Label>Сотрудник</Label>
          <PayrollEmployeePicker employees={data.employees.filter((e) => e.active)} selectedIds={employee ? [employee] : []} disabled={busy} onChange={(ids) => setEmployee(ids[0] ?? "")} />
        </div>
        <div className={formStyle.fields}>
          <div>
            <Label htmlFor="entry-date">{kind === "allowance" ? "Месяц начисления" : "Дата"}</Label>
            {kind === "allowance" ? <PayrollMonthPicker variant="field" ariaLabel="Месяц надбавки" prefix="" value={date} min={data.settings?.starts_on ?? month} disabled={busy} onChange={setDate}/> : <DatePicker id="entry-date" value={date} onChange={setDate} clearable={false}/>}

          </div>
          {kind !== "warning" && kind !== "allowance" && (
            <div>
              <Label htmlFor="entry-medium">Начисление</Label>
              <Select value={medium} onValueChange={setMedium}>
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
        {kind !== "warning" && (
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
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) =>
              setFiles(Array.from(e.target.files ?? []).slice(0, 6))
            }
          />
        </label>
        {kind !== "warning" && medium === "bonus" && (
          <p className={style.parallel}>
            Исполнение бонусной операции зависит от режима работы в разделе «Медкнижки и форма».
          </p>
        )}
      </form>
    </PayrollDetailDialog>
  );
}

"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PeopleListHeader } from "@/components/people/people-list-header";
import { PersonAvatar } from "@/components/people/person-avatar";
import type { CasualStaffRow } from "@/lib/payroll/casual-list";
import {
  createCasualEmployee,
  provisionCasualEmployee,
  type CasualResult,
} from "../casual-actions";

export type CasualIssued = { name: string; roleName: string; pin: string };

const notLinkedBadge =
  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";

function lastShiftLabel(iso: string | null) {
  if (!iso) return "Смен ещё не было";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

async function copyPin(pin: string) {
  try {
    await navigator.clipboard.writeText(pin);
    toast.success("PIN скопирован");
  } catch {
    toast.error("Не удалось скопировать. Выделите код вручную");
  }
}

function handleResult(
  result: CasualResult,
  issued: Omit<CasualIssued, "pin">,
  onIssued: (value: CasualIssued) => void,
) {
  if (result.pin) {
    onIssued({ ...issued, pin: result.pin });
    return true;
  }
  toast.error(result.error ?? "Не удалось завести сотрудника в Quick Resto");
  return false;
}

/** Third tab of «Добавить сотрудника». */
export function CasualCreateForm({
  roles,
  onCancel,
  onSaved,
  onIssued,
}: {
  roles: { id: string; name: string }[];
  onCancel: () => void;
  /** The worker is saved but Quick Resto failed: the list offers a retry. */
  onSaved: () => void;
  onIssued: (value: CasualIssued) => void;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [pending, startTransition] = useTransition();
  const ready = firstName.trim() && lastName.trim() && roleId;
  const submit = () =>
    startTransition(async () => {
      const result = await createCasualEmployee({ firstName, lastName, roleId });
      router.refresh();
      const roleName = roles.find((r) => r.id === roleId)?.name ?? "";
      if (!result.id) {
        toast.error(result.error ?? "Не удалось добавить разового сотрудника");
        return;
      }
      // The worker is saved even when Quick Resto failed: retry from the list.
      if (handleResult(result, { name: `${firstName.trim()} ${lastName.trim()}`, roleName }, onIssued)) {
        setFirstName("");
        setLastName("");
        setRoleId("");
      } else onSaved();
    });
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="casual-first" className="text-[13px] font-medium">
            Имя <span className="text-destructive">*</span>
          </Label>
          <Input id="casual-first" placeholder="Иван" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="casual-last" className="text-[13px] font-medium">
            Фамилия <span className="text-destructive">*</span>
          </Label>
          <Input id="casual-last" placeholder="Иванов" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="casual-role" className="text-[13px] font-medium">
          Должность <span className="text-destructive">*</span>
        </Label>
        <Select value={roleId} onValueChange={setRoleId} disabled={!roles.length}>
          <SelectTrigger id="casual-role">
            <SelectValue placeholder={roles.length ? "Выберите должность" : "Нет подходящих должностей"} />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!roles.length && (
          <p className="text-xs text-muted-foreground">
            Настройте оплату за смену в должности и свяжите её с должностью Quick Resto.
          </p>
        )}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Разовый выходит на смены без входа в Sheerly. Заведём его в Quick Resto с личным PIN, чтобы
        отметки на кассе шли в его зарплату. Гостя, бонусный счёт и чаты не создаём.
      </p>
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" className="flex-1" disabled={!ready || pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Создать
        </Button>
      </div>
    </form>
  );
}

/** PIN shown once the worker is set up in Quick Resto. */
export function CasualPinPanel({ issued, onDone }: { issued: CasualIssued; onDone: () => void }) {
  const first = issued.name.split(" ")[0] ?? issued.name;
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          Заведено в Quick Resto
        </Badge>
        <p className="text-lg font-semibold">{issued.name}</p>
        <p className="text-sm text-muted-foreground">{issued.roleName} · разовый сотрудник</p>
      </div>
      <div className="flex justify-center gap-2" aria-label={`PIN ${issued.pin}`}>
        {issued.pin.split("").map((digit, i) => (
          <span
            key={i}
            className="flex h-16 w-[52px] items-center justify-center rounded-lg border bg-secondary text-3xl font-bold tabular-nums"
          >
            {digit}
          </span>
        ))}
      </div>
      <p className="text-center text-sm leading-relaxed text-muted-foreground">
        Передайте этот код: {first} открывает и закрывает с ним личную смену на кассе. Код останется
        виден в списке разовых.
      </p>
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={() => void copyPin(issued.pin)}>
          <Copy className="size-4" />
          Скопировать
        </Button>
        <Button type="button" className="flex-1" onClick={onDone}>
          Готово
        </Button>
      </div>
    </div>
  );
}

/** For a casual worker created earlier without a code, or a failed attempt. */
function ProvisionDialog({
  employee,
  onClose,
  onIssued,
}: {
  employee: CasualStaffRow | null;
  onClose: () => void;
  onIssued: (value: CasualIssued) => void;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(employee?.firstName ?? "");
  const [lastName, setLastName] = useState(employee?.lastName ?? "");
  const [pending, startTransition] = useTransition();
  if (!employee) return null;
  const submit = () =>
    startTransition(async () => {
      const result = await provisionCasualEmployee({ id: employee.id, firstName, lastName });
      router.refresh();
      if (handleResult(result, { name: `${firstName.trim()} ${lastName.trim()}`, roleName: employee.roleName }, onIssued)) onClose();
    });
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Завести в Quick Resto</DialogTitle>
          <DialogDescription>
            {employee.roleName} · создадим сотрудника кассы со свободным PIN
          </DialogDescription>
        </DialogHeader>
        <form
          id="casual-provision"
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (firstName.trim() && lastName.trim()) submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="provision-first" className="text-[13px] font-medium">Имя</Label>
            <Input id="provision-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provision-last" className="text-[13px] font-medium">Фамилия</Label>
            <Input id="provision-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button type="submit" form="casual-provision" disabled={pending || !firstName.trim() || !lastName.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Завести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PinCell({
  employee,
  canEdit,
  onProvision,
}: {
  employee: CasualStaffRow;
  canEdit: boolean;
  onProvision: (employee: CasualStaffRow) => void;
}) {
  if (employee.pin)
    return <span className="font-mono tabular-nums">{employee.pin}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge variant="outline" className={notLinkedBadge}>
        Нет кода Quick Resto
      </Badge>
      {canEdit && (
        <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => onProvision(employee)}>
          Завести
        </Button>
      )}
    </span>
  );
}

/** «Разовые» view of the staff page. */
export function CasualStaffList({
  employees,
  canEdit,
  actions,
  onIssued,
}: {
  employees: CasualStaffRow[];
  canEdit: boolean;
  actions: ReactNode;
  onIssued: (value: CasualIssued) => void;
}) {
  const router = useRouter();
  const [provisioning, setProvisioning] = useState<CasualStaffRow | null>(null);
  const open = (id: string) => router.push(`/people/payroll/${id}`);
  return (
    <>
      <PeopleListHeader
        title="Сотрудники"
        count={employees.length}
        description="Разовые сотрудники: выходят на смены по графику, отмечаются в кассе своим PIN"
        actions={actions}
      />
      {employees.length ? (
        <>
          <div className="hidden overflow-x-auto rounded-xl border sm:block">
            <table className="w-full min-w-[560px] text-sm" aria-label="Разовые сотрудники">
              <thead>
                <tr className="border-b text-left text-[13px] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Сотрудник</th>
                  <th className="px-4 py-2.5 font-medium">Должность</th>
                  <th className="px-4 py-2.5 font-medium">PIN кассы</th>
                  <th className="px-4 py-2.5 font-medium">Последняя смена</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr
                    key={employee.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest("button,a")) open(employee.id);
                    }}
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        <PersonAvatar name={employee.name} />
                        <span className="font-medium">{employee.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">{employee.roleName}</td>
                    <td className="px-4 py-3">
                      <PinCell employee={employee} canEdit={canEdit} onProvision={setProvisioning} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{lastShiftLabel(employee.lastShiftAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden" aria-label="Карточки разовых сотрудников">
            {employees.map((employee) => (
              <div
                key={employee.id}
                role="button"
                tabIndex={0}
                className="flex min-w-0 flex-col gap-2 rounded-xl border p-3"
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("button,a")) open(employee.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") open(employee.id);
                }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <PersonAvatar name={employee.name} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{employee.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {employee.roleName} · {lastShiftLabel(employee.lastShiftAt)}
                    </span>
                  </span>
                </span>
                <PinCell employee={employee} canEdit={canEdit} onProvision={setProvisioning} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex h-32 items-center justify-center rounded-xl border text-center text-sm text-muted-foreground">
          Разовых сотрудников нет. Добавьте их через «Добавить» → «Разовый».
        </div>
      )}
      {provisioning && (
        <ProvisionDialog
          key={provisioning.id}
          employee={provisioning}
          onClose={() => setProvisioning(null)}
          onIssued={onIssued}
        />
      )}
    </>
  );
}

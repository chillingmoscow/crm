"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { assignInventoryDocument } from "@/app/(dashboard)/inventory/actions";

const UNASSIGNED_VALUE = "__unassigned__";

export type AssigneeOption = {
  id: string;
  name: string;
};

/**
 * Inline-выбор ответственного в строке акта.
 * - Если можно менять (lockReason=null): назначен → бейдж с инициалами +
 *   ФИО, click раскрывает Select. Не назначен → ghost-кнопка «Назначить».
 * - Если менять нельзя (lockReason передан, статусы `processed` /
 *   `sync_error` — см. documents-table.tsx → getAssignLockReason): бейдж
 *   становится ссылкой на страницу сотрудника (`?from=inventory`, чтобы
 *   хлебная крошка вернула в список актов).
 */
export function AssigneeSelect({
  documentId,
  assignedTo,
  staff,
  disabled,
  lockReason,
}: {
  documentId: string;
  assignedTo: string | null;
  staff: AssigneeOption[];
  disabled?: boolean;
  /** Если задано — Select не рендерится, бейдж-ссылка на профиль. */
  lockReason?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const assigned = assignedTo ? staff.find((p) => p.id === assignedTo) ?? null : null;

  // ── Locked-state: ссылка на страницу сотрудника ────────────
  if (lockReason) {
    return assigned ? (
      <Link
        href={`/people/staff/${assigned.id}?from=inventory`}
        title={`Открыть профиль · ${assigned.name}`}
        className="inline-flex h-8 max-w-full items-center gap-2 truncate rounded-full bg-muted/60 px-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <AssigneeAvatar name={assigned.name} muted />
        <span className="truncate">{assigned.name}</span>
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground" title={lockReason}>
        —
      </span>
    );
  }

  const onChange = async (value: string) => {
    const next = value === UNASSIGNED_VALUE ? null : value;
    if (next === assignedTo) return;
    setPending(true);
    try {
      const result = await assignInventoryDocument({ documentId, assignedTo: next });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Исполнитель обновлён");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить исполнителя");
    } finally {
      setPending(false);
    }
  };

  return (
    <Select
      value={assignedTo ?? UNASSIGNED_VALUE}
      onValueChange={onChange}
      disabled={disabled || pending}
    >
      <SelectTrigger
        className={cn(
          "h-8 w-full max-w-full justify-start gap-2 truncate rounded-full px-1 [&>svg:last-child]:opacity-40",
          assigned
            ? "border-transparent bg-muted/60 hover:bg-muted text-foreground"
            : "border-dashed text-muted-foreground hover:text-foreground",
        )}
      >
        {assigned ? (
          <>
            <AssigneeAvatar name={assigned.name} />
            <span className="truncate text-sm">{assigned.name}</span>
          </>
        ) : (
          <>
            <UserPlus className="h-3.5 w-3.5 ml-1.5" />
            <span className="text-sm">Назначить</span>
          </>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <UserPlus className="h-3.5 w-3.5" />
            Не назначен
          </span>
        </SelectItem>
        {staff.map((member) => (
          <SelectItem key={member.id} value={member.id}>
            <span className="inline-flex items-center gap-2">
              <AssigneeAvatar name={member.name} />
              {member.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AssigneeAvatar({ name, muted = false }: { name: string; muted?: boolean }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
        muted ? "bg-muted text-muted-foreground" : "bg-brand/15 text-brand",
      )}
    >
      {initials}
    </div>
  );
}

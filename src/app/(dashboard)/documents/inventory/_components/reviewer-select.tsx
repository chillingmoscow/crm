"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { assignInventoryReviewer } from "@/app/(dashboard)/inventory/_actions/assignment";
import {
  AssigneeAvatar,
  PersonChip,
  inventoryPersonHref,
  type AssigneeOption,
} from "./assignee-select";

const NO_REVIEWER_VALUE = "__no_reviewer__";

/**
 * Inline-выбор проверяющего в строке акта. Зеркало AssigneeSelect, но
 * пишет reviewer_id через assignInventoryReviewer. Проверяющий ведёт итоги,
 * возвращает на пересчёт, финализирует (см. docs/handbook/inventory/statuses.md).
 */
export function ReviewerSelect({
  documentId,
  reviewerId,
  staff,
  disabled,
  lockReason,
  linkToPerson = false,
}: {
  documentId: string;
  reviewerId: string | null;
  staff: AssigneeOption[];
  disabled?: boolean;
  /** Если задано — Select не рендерится, бейдж (ссылка на профиль при linkToPerson). */
  lockReason?: string | null;
  /** Делать бейдж в locked-режиме ссылкой на страницу сотрудника. Только
   *  при доступе к разделу «Сотрудники» (people.view_staff). */
  linkToPerson?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const reviewer = reviewerId ? staff.find((p) => p.id === reviewerId) ?? null : null;

  // ── Locked-state: бейдж (ссылка на сотрудника, если есть доступ) ────────
  if (lockReason) {
    return reviewer ? (
      <PersonChip person={reviewer} href={linkToPerson ? inventoryPersonHref(reviewer.id) : null} />
    ) : (
      <span className="text-sm text-muted-foreground" title={lockReason}>
        —
      </span>
    );
  }

  const onChange = async (value: string) => {
    const next = value === NO_REVIEWER_VALUE ? null : value;
    if (next === reviewerId) return;
    setPending(true);
    try {
      const result = await assignInventoryReviewer({ documentId, reviewerId: next });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Проверяющий обновлён");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить проверяющего");
    } finally {
      setPending(false);
    }
  };

  return (
    <Select
      value={reviewerId ?? NO_REVIEWER_VALUE}
      onValueChange={onChange}
      disabled={disabled || pending}
    >
      <SelectTrigger
        className={cn(
          "h-8 w-full max-w-full justify-start gap-2 truncate rounded-full px-1 [&>svg:last-child]:opacity-40",
          reviewer
            ? "border-transparent bg-muted/60 hover:bg-muted text-foreground"
            : "border-dashed text-muted-foreground hover:text-foreground",
        )}
      >
        {reviewer ? (
          <>
            <AssigneeAvatar name={reviewer.name} />
            <span className="truncate text-sm">{reviewer.name}</span>
          </>
        ) : (
          <>
            <ShieldCheck className="h-3.5 w-3.5 ml-1.5" />
            <span className="text-sm">Проверяющий</span>
          </>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_REVIEWER_VALUE}>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Без проверяющего
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

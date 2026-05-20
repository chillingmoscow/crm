"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignInventoryDocument } from "@/app/(dashboard)/inventory/actions";

const UNASSIGNED_VALUE = "__unassigned__";

export type AssigneeOption = {
  id: string;
  name: string;
};

/**
 * Inline-селектор «Назначен на» в строке акта (desktop).
 * Шейдкн Select для визуальной консистентности (старый код использовал
 * нативный <select>, который выбивается из дизайн-системы — особенно
 * на macOS Safari).
 */
export function AssigneeSelect({
  documentId,
  assignedTo,
  staff,
  disabled,
}: {
  documentId: string;
  assignedTo: string | null;
  staff: AssigneeOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

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
      toast.success("Назначение обновлено");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить назначение");
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
      <SelectTrigger className="h-9 w-full">
        <SelectValue placeholder="Не назначен" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>Не назначен</SelectItem>
        {staff.map((member) => (
          <SelectItem key={member.id} value={member.id}>
            {member.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

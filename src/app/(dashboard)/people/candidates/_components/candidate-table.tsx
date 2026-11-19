"use client";

import Link from "next/link";
import { PersonAvatar } from "@/components/people/person-avatar";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatPhoneDisplay } from "@/lib/format/phone";
import {
  STATUSES,
  type AppointmentOptions,
  type Candidate,
} from "@/lib/candidates/types";
import { overdueHint, stageAge } from "@/lib/candidates/stage-age";
import { dateCell } from "./fields";
import { countRu } from "@/lib/format/plural";
import {
  CandidateStatusCell,
  type CandidateStatusUpdate,
} from "./candidate-status-cell";

export const FIELD_LABELS = {
  full_name: "Кандидат",
  desired_position: "Должность",
  status: "Статус",
  stage_changed_at: "На этапе",
  phone: "Телефон",
  submitted_at: "Дата заявки",
  photo: "Фото",
  age: "Возраст",
  salary_expectation: "Ожидания по зарплате",
  address: "Адрес",
  experience: "Опыт работы",
  education: "Образование",
} as const;
export type CandidateField = keyof typeof FIELD_LABELS;
export const COLUMN_CONFIG = [
  "photo",
  ...Object.keys(FIELD_LABELS).filter((id) => id !== "photo"),
].map((id) => ({
  id,
  defaultVisible: [
    "photo",
    "full_name",
    "desired_position",
    "status",
    "stage_changed_at",
    "phone",
    "submitted_at",
  ].includes(id),
  defaultSize:
    id === "full_name"
      ? 260
      : id === "photo"
        ? 80
        : id === "age" || id === "stage_changed_at"
          ? 128
          : 180,
}));
export function candidateColumns(
  onSaved: (saved: CandidateStatusUpdate) => void,
  onRefresh: () => void,
  options: AppointmentOptions,
  canDelete = false,
): ColumnDef<Candidate>[] {
  const fields: ColumnDef<Candidate>[] = COLUMN_CONFIG.map(
    ({ id, defaultSize }) => ({
      id,
      accessorKey: id,
      header: FIELD_LABELS[id as CandidateField],
      size: defaultSize,
      minSize:
        id === "photo"
          ? 72
          : id === "status"
            ? 184
            : id === "full_name"
              ? 200
              : id === "salary_expectation"
                ? 220
                : id === "desired_position"
                  ? 144
                  : id === "submitted_at"
                    ? 156
                    : id === "stage_changed_at"
                      ? 128
                    : id === "phone"
                      ? 168
                      : 112,
      maxSize: 3000,
      enableHiding: id !== "full_name",
      cell: ({ row }) => {
        const c = row.original;
        if (id === "full_name")
          return (
            <Link
              className="block truncate font-medium hover:text-brand"
              data-tip={c.full_name} data-tip-overflow
              href={`/people/candidates/${c.id}`}
            >
              {c.full_name}
            </Link>
          );
        if (id === "photo")
          return <PersonAvatar
              src={c.photo_thumb_url ?? c.photo_url}
              previewSrc={c.photo_preview_url}
              fallbackSrc={c.photo_url}
              name={c.full_name}
            />;
        if (id === "status")
          return (
            <CandidateStatusCell
              candidate={c}
              onSaved={onSaved}
              onRefresh={onRefresh}
              options={options}
            />
          );
        if (id === "stage_changed_at") {
          const age = stageAge(c.status, c.stage_changed_at);
          if (!age) return <span className="text-muted-foreground">—</span>;
          if (age.overdueAfter === null)
            return <span className="tabular-nums">{age.label}</span>;
          // Залежавшаяся анкета: цвет предупреждения, значок и подсказка,
          // чтобы срок читался не только цветом.
          const hint = overdueHint(age.overdueAfter, STATUSES[c.status]);
          return (
            <span
              className="inline-flex items-center gap-1.5 font-medium tabular-nums text-amber-700 dark:text-amber-400"
              data-tip={hint}
            >
              <Clock className="size-3.5 shrink-0" aria-hidden />
              {age.label}
              <span className="sr-only">. {hint}</span>
            </span>
          );
        }
        const value =
          id === "submitted_at"
            ? dateCell(c.submitted_at)
            : id === "phone"
              ? formatPhoneDisplay(c.phone)
              : id === "age"
                ? c.age
                  ? countRu(c.age, "год", "года", "лет")
                  : "Не указан"
                : c[id as keyof Candidate];
        return (
          <span
            className="block truncate"
            data-tip={value == null ? undefined : String(value)} data-tip-overflow
          >
            {value == null || value === "" ? "Не указано" : String(value)}
          </span>
        );
      },
    }),
  );
  return canDelete
    ? [
        {
          id: "select",
          size: 44,
          minSize: 44,
          maxSize: 44,
          enableHiding: false,
          enableResizing: false,
          cell: ({ row }) => (
            <Checkbox
              checked={row.getIsSelected()}
              disabled={!row.getCanSelect()}
              onCheckedChange={(checked) =>
                row.toggleSelected(checked === true)
              }
              aria-label={`Выбрать анкету: ${row.original.full_name}`}
              className="align-middle"
            />
          ),
        },
        ...fields,
      ]
    : fields;
}

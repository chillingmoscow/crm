"use client";

import Link from "next/link";
import { PersonAvatar } from "@/components/people/person-avatar";
import type { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { formatPhoneDisplay } from "@/lib/format/phone";
import {
  type AppointmentOptions,
  type Candidate,
} from "@/lib/candidates/types";
import { dateLabel, plural } from "./fields";
import {
  CandidateStatusCell,
  type CandidateStatusUpdate,
} from "./candidate-status-cell";

export const FIELD_LABELS = {
  full_name: "Кандидат",
  desired_position: "Должность",
  status: "Статус",
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
    "phone",
    "submitted_at",
  ].includes(id),
  defaultSize:
    id === "full_name" ? 260 : id === "photo" ? 80 : id === "age" ? 100 : 180,
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
              title={c.full_name}
              href={`/people/candidates/${c.id}`}
            >
              {c.full_name}
            </Link>
          );
        if (id === "photo")
          return <PersonAvatar src={c.photo_url} name={c.full_name} />;
        if (id === "status")
          return (
            <CandidateStatusCell
              candidate={c}
              onSaved={onSaved}
              onRefresh={onRefresh}
              options={options}
            />
          );
        const value =
          id === "submitted_at"
            ? dateLabel(c.submitted_at)
            : id === "phone"
              ? formatPhoneDisplay(c.phone)
              : id === "age"
                ? c.age
                  ? `${c.age} ${plural(c.age, ["год", "года", "лет"])}`
                  : "Не указан"
                : c[id as keyof Candidate];
        return (
          <span
            className="block truncate"
            title={value == null ? undefined : String(value)}
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

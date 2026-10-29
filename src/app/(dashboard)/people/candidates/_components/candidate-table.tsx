"use client";

import Link from "next/link";
import Image from "next/image";
import type { ColumnDef } from "@tanstack/react-table";
import {
  STATUSES,
  STATUS_CLASSES,
  type Candidate,
} from "@/lib/candidates/types";
import { dateLabel, plural, StatusBadge } from "./fields";

export const FIELD_LABELS = {
  full_name: "Кандидат",
  desired_position: "Должность",
  status: "Статус",
  phone: "Телефон",
  submitted_at: "Дата заявки",
  photo: "Фотография",
  age: "Возраст",
  salary_expectation: "Ожидания по зарплате",
  address: "Адрес",
  experience: "Опыт работы",
  education: "Образование",
} as const;
export type CandidateField = keyof typeof FIELD_LABELS;
export const COLUMN_CONFIG = Object.keys(FIELD_LABELS).map((id) => ({
  id,
  defaultVisible: [
    "full_name",
    "desired_position",
    "status",
    "phone",
    "submitted_at",
  ].includes(id),
  defaultSize:
    id === "full_name" ? 260 : id === "photo" ? 80 : id === "age" ? 100 : 180,
}));
export const CANDIDATE_COLUMNS: ColumnDef<Candidate>[] = COLUMN_CONFIG.map(
  ({ id, defaultSize }) => ({
    id,
    accessorKey: id,
    header: FIELD_LABELS[id as CandidateField],
    size: defaultSize,
    minSize: id === "photo" ? 60 : 80,
    maxSize: 800,
    enableHiding: id !== "full_name",
    cell: ({ row }) => {
      const c = row.original;
      if (id === "full_name")
        return (
          <Link
            className="block break-words font-medium hover:text-brand"
            href={`/people/candidates/${c.id}`}
          >
            {c.full_name}
          </Link>
        );
      if (id === "photo")
        return c.photo_url ? (
          <Image
            unoptimized
            width={36}
            height={36}
            alt=""
            src={c.photo_url}
            className="size-9 rounded-md object-cover"
          />
        ) : (
          "—"
        );
      if (id === "status")
        return (
          <StatusBadge
            className={STATUS_CLASSES[c.status]}
            label={STATUSES[c.status]}
          />
        );
      const value =
        id === "submitted_at"
          ? dateLabel(c.submitted_at)
          : id === "age"
            ? c.age
              ? `${c.age} ${plural(c.age, ["год", "года", "лет"])}`
              : "Не указан"
            : c[id as keyof Candidate];
      return (
        <span className="line-clamp-3 break-words">
          {value == null || value === "" ? "Не указано" : String(value)}
        </span>
      );
    },
  }),
);

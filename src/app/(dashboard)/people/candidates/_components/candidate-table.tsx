"use client";

import Link from "next/link";
import Image from "next/image";
import type { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { formatPhoneDisplay } from "@/lib/format/phone";
import { type AppointmentOptions, type Candidate } from "@/lib/candidates/types";
import { dateLabel, plural } from "./fields";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
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
export function candidateColumns(
  onSaved: (saved: CandidateStatusUpdate) => void,
  onRefresh: () => void,
  options: AppointmentOptions,
  canDelete = false,
): ColumnDef<Candidate>[] {
  const fields: ColumnDef<Candidate>[] = COLUMN_CONFIG.map(({ id, defaultSize }) => ({
    id,
    accessorKey: id,
    header: FIELD_LABELS[id as CandidateField],
    size: defaultSize,
    minSize: id === "photo" ? 60 : id === "status" ? 180 : 80,
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
          <HoverCard openDelay={150} closeDelay={80}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                aria-label={`Увеличить фотографию: ${c.full_name}`}
                className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Image
                  unoptimized
                  width={36}
                  height={36}
                  alt=""
                  src={c.photo_url}
                  className="size-9 rounded-md object-cover"
                />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="right"
              align="start"
              className="w-auto max-w-[min(340px,calc(100vw-32px))] p-2"
            >
              <Image
                unoptimized
                width={300}
                height={360}
                src={c.photo_url}
                alt={`Фотография кандидата ${c.full_name}`}
                className="max-h-[60vh] max-w-full rounded object-contain"
              />
            </HoverCardContent>
          </HoverCard>
        ) : (
          "—"
        );
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
        <span className="line-clamp-3 break-words">
          {value == null || value === "" ? "Не указано" : String(value)}
        </span>
      );
    },
  }));
  return canDelete ? [{
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
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
        aria-label={`Выбрать анкету: ${row.original.full_name}`}
        className="align-middle"
      />
    ),
  }, ...fields] : fields;
}

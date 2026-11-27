"use client";

import Link from "next/link";

import { PersonAvatar } from "@/components/people/person-avatar";

/** Shared employee identity for payroll and sales. */
export function EmployeeIdentity({
  name,
  role,
  avatarUrl,
  href,
}: {
  name: string;
  role?: string | null;
  avatarUrl?: string | null;
  /**
   * Куда ведёт имя. Правило дизайн-системы «Кликабельное имя»: имя — ссылка,
   * при наведении синеет (text-brand), аватар и должность не меняются.
   * Клик по имени не открывает то, что открывает строка.
   */
  href?: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {/* Строка таблицы сама кликабельна — тихий аватар без карточки фото. */}
      <PersonAvatar src={avatarUrl ?? null} name={name} interactive={false} />
      <span className="flex min-w-0 flex-col gap-1">
        {href ? (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="truncate text-[13px] font-medium leading-5 transition-colors duration-200 hover:text-brand focus-visible:text-brand focus-visible:outline-none"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate text-[13px] font-medium leading-5">
            {name}
          </span>
        )}
        <span className="truncate text-[11px] font-normal leading-4 text-muted-foreground">
          {role || "Должность не указана"}
        </span>
      </span>
    </span>
  );
}

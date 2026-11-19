import Link from "next/link";
import type { ReactNode } from "react";
import { PersonAvatar } from "@/components/people/person-avatar";

/**
 * Подсветка столбца «сегодня» в ячейках сетки — пара из DS («Синий: заливка
 * и текст»): в тёмной теме подложка плотнее, иначе её не видно.
 */
export const TODAY_CELL_CLASS = "bg-brand/5 dark:bg-brand/10";
/** Ячейка, на которую сейчас бросают смену: можно / нельзя. */
export const DROP_OK_CELL_CLASS = "bg-brand/10 dark:bg-brand/15";
export const DROP_REFUSED_CELL_CLASS = "bg-destructive/5 dark:bg-destructive/10";

/**
 * Первая колонка строки недельной сетки: аватар 36px, имя 13px, подпись 12px.
 * Один вид для сотрудников, «Без сотрудника» и стажировок кандидатов.
 */
export function GridRowPerson({
  name,
  subtitle,
  avatarSrc,
  icon,
  href,
}: {
  name: string;
  subtitle?: ReactNode;
  avatarSrc?: string | null;
  /** Вместо аватара — значок (строка «Без сотрудника»). */
  icon?: ReactNode;
  /** Ссылка на карточку человека; без неё строка не кликается. */
  href?: string | null;
}) {
  const person = (
    <>
      {icon ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </span>
      ) : (
        <PersonAvatar name={name} src={avatarSrc} />
      )}
      <div className="min-w-0">
        <p className="break-words text-[13px] font-medium group-hover/person:text-brand">
          {name}
        </p>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="group/person -m-1 flex items-center gap-3 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {person}
    </Link>
  ) : (
    <div className="flex items-center gap-3">{person}</div>
  );
}

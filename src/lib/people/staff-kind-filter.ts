export type StaffKindFilter = "" | "staff" | "casual" | "official";

/**
 * Подходит ли строка списка сотрудников под фильтр «Тип». `kind` — вид строки
 * (штатный, разовый, приглашение, уволенный), `userId` — пользователь штатного
 * сотрудника, `officialUserIds` — те, у кого сегодня открыт период
 * официального трудоустройства.
 */
export function matchesStaffKind(
  filter: string,
  row: { kind: "staff" | "fired" | "invitation" | "casual"; userId?: string | null },
  officialUserIds: ReadonlySet<string>,
): boolean {
  if (!filter) return true;
  if (filter === "official")
    return row.kind === "staff" && !!row.userId && officialUserIds.has(row.userId);
  return (filter === "casual") === (row.kind === "casual");
}

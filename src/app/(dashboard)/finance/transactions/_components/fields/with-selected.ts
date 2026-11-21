/**
 * В выборе — действующие записи и та, что уже стоит в операции, даже если
 * её отправили в архив: иначе старая операция показала бы «Без статьи».
 */
export function withSelected<
  T extends { id: string; archived_at?: string | null; deleted_at?: string | null },
>(list: T[], selectedId: string | null): T[] {
  return list.filter((item) => (!item.archived_at && !item.deleted_at) || item.id === selectedId);
}

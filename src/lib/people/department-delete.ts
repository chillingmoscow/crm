/** Почему подразделение нельзя удалить из-за допродаж (миграция 380).
 *
 *  Участие подразделения в допродажах хранит версии правил и посчитанные дни,
 *  от которых зависит зарплата, поэтому база не даёт удалить такое
 *  подразделение (FK без каскада). Архива подразделений в интерфейсе нет,
 *  поэтому текст не предлагает архивировать. */

export const UPSELL_DEPARTMENT_DELETE_BLOCK =
  "Подразделение участвует в допродажах: по его правилам считается зарплата. Удалить его нельзя.";

const UPSELL_DEPARTMENT_FK = "sales_upsell_departments_department_id_fkey";

/** Ошибка удаления — именно ограничение участия в допродажах, а не любое
 *  другое нарушение внешнего ключа (их объясняют своими текстами). */
export function isUpsellDepartmentFkError(
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined,
): boolean {
  if (!error || error.code !== "23503") return false;
  return `${error.message ?? ""} ${error.details ?? ""}`.includes(UPSELL_DEPARTMENT_FK);
}

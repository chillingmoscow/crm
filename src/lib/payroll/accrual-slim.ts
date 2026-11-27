import type { Accrual } from "./types";

// Снимок расчёта хранит всё, из чего посчитано начисление: правила, модель
// оплаты, правила допродаж. Обзору зарплаты из него нужны только вид
// начисления, источник выхода, должность (position_name, role, id модели) и
// данные старого учёта для выписки — остальное ~0,8 МБ уходило в браузер зря
// и тормозило переход в раздел. Карточка сотрудника читает снимок целиком.
const OVERVIEW_SNAPSHOT_KEYS = ["kind", "source", "position_name", "role", "legacy"] as const;

export function slimOverviewAccrual<T extends Accrual>(accrual: T): T {
  const snapshot = accrual.calculation_snapshot ?? {};
  const slim: Record<string, unknown> = {};
  for (const key of OVERVIEW_SNAPSHOT_KEYS) if (key in snapshot) slim[key] = snapshot[key];
  const model = snapshot.model as { id?: unknown } | null | undefined;
  if (model && typeof model === "object") slim.model = { id: model.id };
  return { ...accrual, calculation_snapshot: slim };
}

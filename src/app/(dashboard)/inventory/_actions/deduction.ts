"use server";

// Единственная браузерная точка входа удержания по недостаче: ручной пересчёт месяца
// выбранного заведения. Вся работа - в ../deduction-service.ts (там же проверки: аккаунт
// сессии, принадлежность заведения аккаунту, право ставить удержания, запись только
// серверным клиентом). Остальные входы (после итогов акта, разнесения списаний, привязки
// склада, правил) внутренние и из браузера недоступны.

import {
  recalculateInventoryDeductionMonth,
  type DeductionActionResult,
} from "../deduction-service";
import { actionErrorMessage } from "../actions-shared";

export async function recalculateInventoryDeduction(input: {
  venueId: string;
  month: string;
}): Promise<DeductionActionResult> {
  try {
    return await recalculateInventoryDeductionMonth(input);
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось пересчитать удержание"), summary: null };
  }
}

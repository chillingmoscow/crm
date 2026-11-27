"use server";

import { actionResult } from "@/lib/actions/result";
import { loadShiftNow } from "@/lib/home/shift-now";

/** Тихое обновление «Смены сейчас» на видимой вкладке главной. */
export async function refreshShiftNow() {
  return actionResult(async () => {
    const data = await loadShiftNow();
    if (!data) throw new Error("Выберите заведение");
    return data;
  }, "Не удалось обновить смену");
}

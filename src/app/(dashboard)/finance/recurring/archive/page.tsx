import { redirect } from "next/navigation";

/**
 * Архив повторяющихся платежей открывается кнопкой «Архив» в ряду
 * инструментов списка (как у счетов). Отдельный адрес остаётся рабочим
 * (закладки, ссылки из справки).
 */
export default function RecurringArchivePage() {
  redirect("/finance/recurring?archive=1");
}

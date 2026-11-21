import { redirect } from "next/navigation";

/**
 * Архив статей открывается кнопкой «Архив» в ряду инструментов списка.
 * Старый адрес остаётся рабочим (закладки, ссылки из справки).
 */
export default function FinanceCategoriesArchivePage() {
  redirect("/finance/categories?archive=1");
}

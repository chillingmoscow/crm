import { redirect } from "next/navigation";

/**
 * Архив контрагентов открывается кнопкой «Архив» в ряду инструментов списка.
 * Старый адрес остаётся рабочим (закладки, ссылки из справки).
 */
export default function CounterpartiesArchivePage() {
  redirect("/finance/counterparties?archive=1");
}

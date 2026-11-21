import { redirect } from "next/navigation";

/**
 * Архив счетов открывается кнопкой «Архив» в ряду инструментов списка.
 * Старый адрес остаётся рабочим (закладки, ссылки из справки).
 */
export default function BankAccountsArchivePage() {
  redirect("/finance/accounts?archive=1");
}

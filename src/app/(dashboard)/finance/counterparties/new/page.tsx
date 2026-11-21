import { redirect } from "next/navigation";

/**
 * Контрагент создаётся в панели на странице списка. Старый адрес остаётся
 * рабочим (закладки, ссылки из справки): открывает список с панелью.
 */
export default function NewCounterpartyPage() {
  redirect("/finance/counterparties?create=1");
}

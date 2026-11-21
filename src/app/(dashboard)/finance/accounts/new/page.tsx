import { redirect } from "next/navigation";

/**
 * Счёт создаётся в панели на странице списка. Старый адрес остаётся
 * рабочим: открывает список с панелью.
 */
export default function NewBankAccountPage() {
  redirect("/finance/accounts?create=1");
}

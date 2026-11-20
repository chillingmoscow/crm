import { redirect } from "next/navigation";

/**
 * Юрлицо создаётся в панели на странице списка. Старый адрес остаётся
 * рабочим (закладки, ссылки из справки): открывает список с панелью.
 */
export default function NewLegalEntityPage() {
  redirect("/org/legal-entities?create=1");
}

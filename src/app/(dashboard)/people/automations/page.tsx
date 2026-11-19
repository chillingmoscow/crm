import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Отдельного экрана автоматизаций нет: они (стаж, премии, штрафы,
// уведомления) настраиваются в «Условиях оплаты» заведения — туда и ведёт
// старый адрес. Без активного заведения — в «Зарплату».
export default async function AutomationsRedirectPage() {
  const supabase = await createClient();
  const { data: venueId } = await supabase.rpc("get_active_venue_id");
  redirect(venueId ? `/org/venues/${venueId}/payroll` : "/people/payroll");
}

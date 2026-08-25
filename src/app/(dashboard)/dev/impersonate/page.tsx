import { notFound, redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/server";
import { isImpersonationAllowed } from "@/lib/impersonation/config";
import { listImpersonationTargets } from "@/lib/impersonation/actions";
import { readActiveImpersonation } from "@/lib/impersonation/session";
import { ImpersonatePicker } from "./_components/impersonate-picker";

/**
 * /dev/impersonate — вход в режим «смотреть глазами другого пользователя».
 *
 * Гейт — только allowlist в env (IMPERSONATION_ALLOWED_USER_IDS), не право
 * и не роль: механика подменяет сессию по-настоящему, поэтому включаться
 * она должна там же, где живут секреты прода. Для всех остальных страницы
 * не существует (notFound, а не redirect — незачем подсказывать, что тут
 * что-то есть).
 */
export default async function ImpersonatePage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  if (!isImpersonationAllowed(user.id)) notFound();

  const [{ targets, error }, impersonation] = await Promise.all([
    listImpersonationTargets(),
    readActiveImpersonation(),
  ]);

  return (
    <ImpersonatePicker
      targets={targets}
      loadError={error}
      alreadyImpersonating={Boolean(impersonation)}
    />
  );
}

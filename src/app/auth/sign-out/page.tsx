import { redirect } from "next/navigation";

import { readActiveImpersonation } from "@/lib/impersonation/session";
import { SignOutRunner } from "./_components/sign-out-runner";

/**
 * /auth/sign-out — выход из СВОЕЙ сессии + редирект на ?next= (default /login).
 *
 * Раньше был server-route с supabase.auth.signOut() — в проде висел /
 * timed out (видимо, server-side GoTrue endpoint иногда долго отвечает,
 * + Next.js RSC-prefetch шлёт side-effecting GET). Сам выход остался
 * клиентским (см. _components/sign-out-runner.tsx), серверной осталась
 * только проверка ниже.
 *
 * Проверка нужна вот зачем: пока идёт просмотр за другого пользователя,
 * текущая сессия — не ваша, а синтетическая. Выходить из неё нечем:
 * глобальный signOut отозвал бы токены сотрудника на всех его
 * устройствах, локальный оставил бы вас разлогиненным с чужим «обратным
 * билетом» в куке. Поэтому из режима просмотра ровно один выход —
 * вернуться к себе, и уже потом выходить. Здесь мы просто возвращаем
 * человека в приложение, где эта кнопка есть (баннер сверху и пункт в
 * меню профиля).
 */
export default async function SignOutPage() {
  // Падаем ОТКРЫТО: если проверка сама сломалась, пускаем выходить.
  // Невозможность выйти из аккаунта — худший исход, чем пропущенный
  // редирект, а пропуск ничем не грозит: билет привязан к session_id,
  // после нового входа он мёртв.
  let impersonating = false;
  try {
    impersonating = Boolean(await readActiveImpersonation());
  } catch {
    impersonating = false;
  }

  // redirect() вне try — он бросает NEXT_REDIRECT, и catch выше принял бы
  // собственный редирект за поломку проверки.
  if (impersonating) redirect("/dashboard");

  return <SignOutRunner />;
}

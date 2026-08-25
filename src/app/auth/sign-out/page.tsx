"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { unsubscribePushForSignOut } from "@/lib/push/client";
import { clearImpersonationForSignOut } from "@/lib/impersonation/actions";

/**
 * /auth/sign-out — client-side sign-out + редирект на ?next= (default /login).
 *
 * Раньше был server-route с supabase.auth.signOut() — в проде висел /
 * timed out (видимо, server-side GoTrue endpoint иногда долго отвечает,
 * + Next.js RSC-prefetch шлёт side-effecting GET). Теперь client:
 * мгновенно чистит куки на стороне браузера, потом router.replace.
 *
 * Suspense-wrapper: Next 15 требует чтобы `useSearchParams()` жил под
 * Suspense — иначе static-prerender падает с «missing-suspense-with-csr-
 * bailout» (Coolify build #260 поймал именно это). Само ожидание params
 * мгновенно (это client-side bailout, не data-fetch), так что fallback
 * показывает тот же спиннер.
 */
export default function SignOutPage() {
  return (
    <Suspense fallback={<SignOutShell />}>
      <SignOutInner />
    </Suspense>
  );
}

function SignOutInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const next = params.get("next") || "/login";
    const supabase = createClient();
    // Отписываем браузер от push ДО signOut (server action требует
    // активной сессии). На общем устройстве это не даёт следующему
    // юзеру получать push прежнего владельца.
    // scope: 'local' — без round-trip'а на GoTrue, просто чистим
    // sb-cookies локально. Этого достаточно для нашего case'а
    // (юзер сменил email и хочет залогиниться заново).
    // clearImpersonationForSignOut — кука с «обратным билетом» httpOnly,
    // клиентский signOut() её не тронет. Без этого после следующего входа
    // под собой висел бы мёртвый impersonation-баннер.
    // .catch по тому же принципу, что и у unsubscribePushForSignOut:
    // это best-effort уборка, и её сбой не должен оборвать цепочку до
    // самого signOut — иначе сетевой блип оставил бы юзера залогиненным.
    unsubscribePushForSignOut()
      .then(() => clearImpersonationForSignOut().catch(() => {}))
      .then(() => supabase.auth.signOut({ scope: "local" }))
      .finally(() => router.replace(next));
  }, [params, router]);

  return <SignOutShell />;
}

function SignOutShell() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />
      <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
    </div>
  );
}

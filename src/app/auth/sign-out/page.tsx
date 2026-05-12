"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/**
 * /auth/sign-out — client-side sign-out + редирект на ?next= (default /login).
 *
 * Раньше был server-route с supabase.auth.signOut() — в проде висел /
 * timed out (видимо, server-side GoTrue endpoint иногда долго отвечает,
 * + Next.js RSC-prefetch шлёт side-effecting GET). Теперь client:
 * мгновенно чистит куки на стороне браузера, потом router.replace.
 */
export default function SignOutPage() {
  const router = useRouter();
  const params = useSearchParams();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const next = params.get("next") || "/login";
    const supabase = createClient();
    // scope: 'local' — без round-trip'а на GoTrue, просто чистим
    // sb-cookies локально. Этого достаточно для нашего case'а
    // (юзер сменил email и хочет залогиниться заново).
    supabase.auth
      .signOut({ scope: "local" })
      .finally(() => router.replace(next));
  }, [params, router]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />
      <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
    </div>
  );
}

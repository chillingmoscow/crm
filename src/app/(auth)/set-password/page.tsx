"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { safeAuthRedirectPath } from "@/lib/auth/redirects";
import { useAuthLeave } from "../_components/auth-shell";
import { AuthLoading } from "../_components/auth-ui";
import { NewPasswordForm } from "../_components/new-password-form";

function mapSupabaseError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("new password should be different from the old password")) {
    return "Новый пароль должен отличаться от старого.";
  }
  return "Не удалось сохранить пароль. Попробуйте ещё раз.";
}

function SetPasswordContent() {
  const searchParams = useSearchParams();
  const leave = useAuthLeave();
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);

  // Сессию ставит /auth/confirm по ссылке из приглашения.
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) setSessionReady(true);
      else setLinkError("Ссылка для приглашения недействительна или устарела.");
      setChecking(false);
    };
    void check();
    return () => {
      mounted = false;
    };
  }, []);

  const save = async (password: string) => {
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return mapSupabaseError(error.message);
    // Пароль сохранён — в приложение (принять приглашение, онбординг):
    // обычно /invite?invitation=ID, только путь на своём сайте.
    leave(safeAuthRedirectPath(searchParams.get("next")));
    return null;
  };

  if (checking) return <AuthLoading label="Проверяем приглашение" />;

  return (
    <NewPasswordForm
      title="Создайте пароль"
      description="С ним вы будете входить в Sheerly."
      submitLabel="Продолжить"
      ready={sessionReady}
      error={linkError}
      onSave={save}
    />
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoading label="Проверяем приглашение" />}>
      <SetPasswordContent />
    </Suspense>
  );
}

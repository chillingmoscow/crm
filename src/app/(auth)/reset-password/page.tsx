"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { isRateLimited, RATE_LIMIT_MESSAGE } from "@/lib/auth/auth-errors";
import { Button } from "@/components/ui/button";
import { AuthHeader, AuthLoading, BackToLogin } from "../_components/auth-ui";
import { NewPasswordForm } from "../_components/new-password-form";

const LINK_EXPIRED = "Ссылка для восстановления недействительна или устарела.";

function mapSupabaseResetError(error: { message: string; status?: number; code?: string }) {
  if (isRateLimited(error)) return RATE_LIMIT_MESSAGE;
  const lower = error.message.toLowerCase();
  if (lower.includes("new password should be different from the old password")) {
    return "Новый пароль должен отличаться от старого.";
  }
  return "Не удалось обновить пароль. Попробуйте ещё раз.";
}

export default function ResetPasswordPage() {
  const [done, setDone] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const prepareRecoverySession = async () => {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      // Уже есть сессия — пароль можно менять сразу.
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        if (isMounted) {
          setEmail(sessionData.session.user.email ?? null);
          setTokenReady(true);
          setTokenLoading(false);
        }
        return;
      }

      if (!tokenHash || type !== "recovery") {
        if (isMounted) {
          setLinkError(LINK_EXPIRED);
          setTokenLoading(false);
        }
        return;
      }

      const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });

      if (isMounted) {
        if (verifyError) setLinkError(LINK_EXPIRED);
        else {
          setEmail(verified.user?.email ?? null);
          setTokenReady(true);
        }
        setTokenLoading(false);
      }
    };

    void prepareRecoverySession();
    return () => {
      isMounted = false;
    };
  }, []);

  const save = async (password: string) => {
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return mapSupabaseResetError(error);
    setDone(true);
    return null;
  };

  if (tokenLoading) return <AuthLoading label="Проверяем ссылку" />;

  if (done) {
    return (
      <div className="motion-rise">
        <AuthHeader
          icon={<Check />}
          tone="success"
          title="Пароль обновлён"
          description="Теперь войдите с новым паролем."
        />
        <Button asChild className="w-full">
          <Link href="/login">Войти</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <NewPasswordForm
        title="Новый пароль"
        description="Придумайте пароль, которого не было раньше."
        submitLabel="Сохранить"
        ready={tokenReady}
        error={linkError}
        email={email}
        onSave={save}
      />
      <BackToLogin />
    </>
  );
}

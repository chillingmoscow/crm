"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { verificationHero } from "@/components/auth/auth-content";
import {
  AuthBackLink,
  AuthLoadingScreen,
  AuthNotice,
  AuthPrimaryButton,
  AuthShell,
  AuthStatusCard,
} from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/client";

export default function EmailConfirmedPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const verifySignup = async () => {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      if (!tokenHash || type !== "signup") {
        if (isMounted) {
          setError("Ссылка подтверждения недействительна или уже устарела.");
          setLoading(false);
        }
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "signup",
      });

      if (!isMounted) {
        return;
      }

      if (verifyError) {
        setError("Не удалось подтвердить почту. Запросите новое письмо и попробуйте ещё раз.");
      }

      setLoading(false);
    };

    void verifySignup();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return <AuthLoadingScreen label="Подтверждаем электронную почту" />;
  }

  if (error) {
    return (
      <AuthShell hero={verificationHero}>
        <AuthStatusCard
          badge="Verification error"
          icon={<AlertCircle className="h-5 w-5" />}
          title="Не удалось подтвердить почту"
          description={error}
          actions={
            <>
              <AuthPrimaryButton asChild className="max-w-full sm:max-w-[320px]">
                <Link href="/register">Зарегистрироваться снова</Link>
              </AuthPrimaryButton>
              <AuthBackLink href="/login">Вернуться ко входу</AuthBackLink>
            </>
          }
        >
          <AuthNotice variant="error">
            Если письмо пришло давно, безопаснее запросить новую ссылку и пройти подтверждение заново.
          </AuthNotice>
        </AuthStatusCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell hero={verificationHero}>
      <AuthStatusCard
        badge="Verification success"
        icon={<CheckCircle2 className="h-5 w-5" />}
        title="Почта подтверждена"
        description="Аккаунт активирован. Можно возвращаться к работе в Sheerly."
        actions={
          <AuthPrimaryButton asChild className="max-w-full sm:max-w-[320px]">
            <Link href="/dashboard">Открыть систему</Link>
          </AuthPrimaryButton>
        }
      >
        <AuthNotice variant="success">
          Статус аккаунта обновлён, а визуальный поток остаётся тем же в светлой и тёмной теме.
        </AuthNotice>
      </AuthStatusCard>
    </AuthShell>
  );
}

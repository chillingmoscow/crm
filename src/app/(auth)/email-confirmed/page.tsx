"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, Check } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuthLeave } from "../_components/auth-shell";
import { AuthHeader, AuthLoading } from "../_components/auth-ui";

export default function EmailConfirmedPage() {
  const leave = useAuthLeave();
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
          setError("Ссылка подтверждения недействительна или устарела.");
          setLoading(false);
        }
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "signup",
      });

      if (isMounted) {
        if (verifyError) {
          setError("Не удалось подтвердить почту. Запросите новое письмо.");
        }
        setLoading(false);
      }
    };

    void verifySignup();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) return <AuthLoading label="Подтверждаем почту" />;

  if (error) {
    return (
      <div className="motion-rise">
        <AuthHeader
          icon={<AlertCircle />}
          tone="danger"
          title="Почта не подтверждена"
          description={error}
        />
        <Button asChild className="w-full">
          <Link href="/register">Зарегистрироваться снова</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="motion-rise">
      <AuthHeader
        icon={<Check />}
        tone="success"
        title="Почта подтверждена"
        description="Аккаунт активирован. Добро пожаловать в Sheerly!"
      />
      <Button className="w-full" onClick={() => leave("/dashboard")}>
        Войти в Sheerly
      </Button>
    </div>
  );
}

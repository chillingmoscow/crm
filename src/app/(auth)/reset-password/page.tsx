"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { recoveryHero } from "@/components/auth/auth-content";
import {
  AuthBackLink,
  AuthCard,
  AuthField,
  AuthLoadingScreen,
  AuthNotice,
  AuthPasswordMeter,
  AuthPrimaryButton,
  AuthShell,
  AuthStatusCard,
} from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/client";

type PasswordTone = "weak" | "medium" | "good" | "strong";

const resetSchema = z
  .object({
    password: z
      .string()
      .min(8, "Минимум 8 символов и 2 буквы")
      .regex(/(?:[^\p{L}]*\p{L}){2}/u, "Минимум 8 символов и 2 буквы"),
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Пароли не совпадают",
    path: ["confirm_password"],
  });

type ResetForm = z.infer<typeof resetSchema>;

function hasMinTwoLetters(value: string) {
  const letters = value.match(/\p{L}/gu);
  return (letters?.length ?? 0) >= 2;
}

function mapSupabaseResetError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("new password should be different from the old password")) {
    return "Новый пароль должен отличаться от старого.";
  }

  return "Не удалось обновить пароль. Попробуйте ещё раз.";
}

function getPasswordStrength(password: string): {
  level: number;
  label: string;
  tone: PasswordTone;
} {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) {
    return { level: 1, label: "Слабый пароль. Добавьте длину и разнообразие символов.", tone: "weak" };
  }

  if (score <= 2) {
    return { level: 2, label: "Средний пароль. Можно усилить цифрами или символами.", tone: "medium" };
  }

  if (score <= 3) {
    return { level: 3, label: "Хороший пароль.", tone: "good" };
  }

  return { level: 4, label: "Надёжный пароль.", tone: "strong" };
}

export default function ResetPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(true);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const password = watch("password") ?? "";
  const confirmPassword = watch("confirm_password") ?? "";
  const isFormReady =
    password.length >= 8 && hasMinTwoLetters(password) && confirmPassword.length > 0;
  const strength = getPasswordStrength(password);

  useEffect(() => {
    let isMounted = true;

    const prepareRecoverySession = async () => {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      const { data: sessionData } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (sessionData.session) {
        setTokenReady(true);
        setTokenLoading(false);
        return;
      }

      if (!tokenHash || type !== "recovery") {
        setGlobalError("Ссылка для восстановления недействительна или уже устарела.");
        setTokenLoading(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });

      if (!isMounted) {
        return;
      }

      if (verifyError) {
        setGlobalError("Ссылка для восстановления недействительна или уже устарела.");
      } else {
        setTokenReady(true);
      }

      setTokenLoading(false);
    };

    void prepareRecoverySession();

    return () => {
      isMounted = false;
    };
  }, []);

  const onSubmit = async (data: ResetForm) => {
    if (!tokenReady) {
      return;
    }

    setLoading(true);
    setGlobalError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({ password: data.password });

    if (error) {
      setGlobalError(mapSupabaseResetError(error.message));
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  };

  if (tokenLoading) {
    return <AuthLoadingScreen label="Проверяем ссылку для восстановления" />;
  }

  if (!tokenReady) {
    return (
      <AuthShell hero={recoveryHero}>
        <AuthStatusCard
          badge="Recovery link"
          icon={<AlertCircle className="h-5 w-5" />}
          title="Ссылка больше не действует"
          description={globalError ?? "Не удалось подготовить страницу восстановления."}
          actions={
            <>
              <AuthPrimaryButton asChild className="max-w-full sm:max-w-[320px]">
                <Link href="/forgot-password">Запросить новую ссылку</Link>
              </AuthPrimaryButton>
              <AuthBackLink>Вернуться ко входу</AuthBackLink>
            </>
          }
        >
          <AuthNotice variant="error">
            В целях безопасности ссылки восстановления работают ограниченное время.
          </AuthNotice>
        </AuthStatusCard>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell hero={recoveryHero}>
        <AuthStatusCard
          badge="Password updated"
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="Пароль обновлён"
          description="Новый пароль сохранён. Можно вернуться ко входу и продолжить работу."
          actions={
            <AuthPrimaryButton asChild className="max-w-full sm:max-w-[320px]">
              <Link href="/login">Войти в систему</Link>
            </AuthPrimaryButton>
          }
        >
          <AuthNotice variant="success">
            Безопасный поток завершён. Следующий вход будет работать уже с новым паролем.
          </AuthNotice>
        </AuthStatusCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell hero={recoveryHero}>
      <AuthCard
        badge="Reset password"
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Создайте новый пароль"
        description="Новый пароль должен отличаться от предыдущих и оставаться удобным для ежедневного входа."
        footer={
          <div className="text-center">
            <AuthBackLink>Вернуться ко входу</AuthBackLink>
          </div>
        }
      >
        <div className="space-y-5">
          {globalError ? <AuthNotice variant="error">{globalError}</AuthNotice> : null}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="space-y-3">
              <AuthField
                label="Новый пароль"
                type={showPass ? "text" : "password"}
                placeholder="Придумайте новый пароль"
                autoComplete="new-password"
                error={errors.password?.message}
                icon={<KeyRound className="h-4 w-4" />}
                rightSlot={
                  <button
                    type="button"
                    onClick={() => setShowPass((value) => !value)}
                    className="text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                    aria-label={showPass ? "Скрыть пароль" : "Показать пароль"}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
                {...register("password")}
              />

              <AuthPasswordMeter
                value={password}
                label={password ? strength.label : "Минимум 8 символов и 2 буквы."}
                level={strength.level}
                tone={strength.tone}
              />
            </div>

            <AuthField
              label="Подтвердите пароль"
              type={showConfirm ? "text" : "password"}
              placeholder="Повторите новый пароль"
              autoComplete="new-password"
              error={errors.confirm_password?.message}
              icon={<KeyRound className="h-4 w-4" />}
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowConfirm((value) => !value)}
                  className="text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                  aria-label={showConfirm ? "Скрыть пароль" : "Показать пароль"}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
              {...register("confirm_password")}
            />

            <AuthPrimaryButton type="submit" disabled={loading || !isFormReady}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Сохранить пароль
            </AuthPrimaryButton>
          </form>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

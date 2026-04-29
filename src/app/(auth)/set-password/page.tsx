"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { inviteHero } from "@/components/auth/auth-content";
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

const setPasswordSchema = z
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

type SetPasswordForm = z.infer<typeof setPasswordSchema>;

function hasMinTwoLetters(value: string) {
  const letters = value.match(/\p{L}/gu);
  return (letters?.length ?? 0) >= 2;
}

function mapSupabaseError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("new password should be different from the old password")) {
    return "Новый пароль должен отличаться от старого.";
  }

  return "Не удалось сохранить пароль. Попробуйте ещё раз.";
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
    return { level: 1, label: "Слабый пароль. Добавьте длину и дополнительные символы.", tone: "weak" };
  }

  if (score <= 2) {
    return { level: 2, label: "Средний пароль. Уже лучше, но его можно усилить.", tone: "medium" };
  }

  if (score <= 3) {
    return { level: 3, label: "Хороший пароль.", tone: "good" };
  }

  return { level: 4, label: "Надёжный пароль.", tone: "strong" };
}

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);

  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") ? rawNext : "/dashboard";

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SetPasswordForm>({
    resolver: zodResolver(setPasswordSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const password = watch("password") ?? "";
  const confirmPassword = watch("confirm_password") ?? "";
  const isFormReady =
    password.length >= 8 && hasMinTwoLetters(password) && confirmPassword.length > 0;
  const strength = getPasswordStrength(password);

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      if (data.session) {
        setSessionReady(true);
      } else {
        setGlobalError("Ссылка приглашения недействительна или уже использована.");
      }

      setChecking(false);
    };

    void checkSession();

    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (data: SetPasswordForm) => {
    if (!sessionReady) {
      return;
    }

    setLoading(true);
    setGlobalError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({ password: data.password });

    if (error) {
      setGlobalError(mapSupabaseError(error.message));
      setLoading(false);
      return;
    }

    router.push(next);
  };

  if (checking) {
    return <AuthLoadingScreen label="Проверяем приглашение" />;
  }

  if (!sessionReady) {
    return (
      <AuthShell hero={inviteHero}>
        <AuthStatusCard
          badge="Invite error"
          icon={<AlertCircle className="h-5 w-5" />}
          title="Приглашение недоступно"
          description={globalError ?? "Не удалось подготовить приглашение к активации."}
          actions={
            <>
              <AuthPrimaryButton asChild className="max-w-full sm:max-w-[320px]">
                <Link href="/login">Открыть вход</Link>
              </AuthPrimaryButton>
              <AuthBackLink href="/login">Вернуться ко входу</AuthBackLink>
            </>
          }
        >
          <AuthNotice variant="error">
            Если приглашение было отправлено давно, запросите у администратора новую ссылку.
          </AuthNotice>
        </AuthStatusCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell hero={inviteHero}>
      <AuthCard
        badge="Invite setup"
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Создайте пароль"
        description="Остался один шаг: задайте пароль для первого входа, после чего мы сразу переведём вас в систему."
        footer={
          <div className="text-center">
            <AuthBackLink href="/login">Вернуться ко входу</AuthBackLink>
          </div>
        }
      >
        <div className="space-y-5">
          {globalError ? <AuthNotice variant="error">{globalError}</AuthNotice> : null}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="space-y-3">
              <AuthField
                label="Пароль"
                type={showPass ? "text" : "password"}
                placeholder="Придумайте пароль"
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
              placeholder="Повторите пароль"
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
              Сохранить и продолжить
            </AuthPrimaryButton>
          </form>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen label="Подготавливаем приглашение" />}>
      <SetPasswordContent />
    </Suspense>
  );
}

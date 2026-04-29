"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Mail } from "lucide-react";

import { loginHero } from "@/components/auth/auth-content";
import {
  AuthCard,
  AuthField,
  AuthNotice,
  AuthPrimaryButton,
  AuthShell,
} from "@/components/auth/auth-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const loginSchema = z.object({
  email: z.string().email("Проверьте правильность email"),
  password: z.string().min(1, "Введите пароль"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const email = watch("email") ?? "";
  const password = watch("password") ?? "";
  const isFormReady = email.includes("@") && password.length > 0;

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setGlobalError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      const message = error.message.toLowerCase();

      if (message.includes("invalid login credentials")) {
        setGlobalError("Неверный email или пароль.");
      } else if (message.includes("email not confirmed")) {
        setGlobalError("Почта не подтверждена. Проверьте входящие и папку «Спам».");
      } else {
        setGlobalError("Не удалось выполнить вход. Попробуйте ещё раз.");
      }

      setLoading(false);
      return;
    }

    router.push("/dashboard");
  };

  return (
    <AuthShell hero={loginHero}>
      <AuthCard
        badge="Secure sign in"
        icon={<LockKeyhole className="h-5 w-5" />}
        title="Войти в рабочее пространство"
        description="Используйте рабочую почту и пароль, чтобы продолжить работу с командами, ролями и заведениями."
        footer={
          <p className="text-center">
            Нет аккаунта?{" "}
            <Link
              href="/register"
              className="font-medium text-slate-900 underline-offset-4 hover:underline dark:text-white"
            >
              Создать доступ
            </Link>
          </p>
        }
      >
        <div className="space-y-5">
          {globalError ? <AuthNotice variant="error">{globalError}</AuthNotice> : null}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthField
              label="Рабочая почта"
              type="email"
              placeholder="name@company.ru"
              autoComplete="email"
              error={errors.email?.message}
              icon={<Mail className="h-4 w-4" />}
              {...register("email")}
            />

            <AuthField
              label="Пароль"
              type={showPass ? "text" : "password"}
              placeholder="Введите пароль"
              autoComplete="current-password"
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

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="remember_me"
                  checked={rememberMe}
                  onCheckedChange={(value) => setRememberMe(value === true)}
                  className="rounded-md border-slate-300 data-[state=checked]:border-sky-500 data-[state=checked]:bg-sky-500 dark:border-white/15 dark:data-[state=checked]:border-sky-400 dark:data-[state=checked]:bg-sky-400"
                />
                <Label htmlFor="remember_me" className="text-sm text-slate-600 dark:text-slate-300">
                  Запомнить меня
                </Label>
              </div>

              <Link
                href="/forgot-password"
                className="text-sm font-medium text-sky-700 underline-offset-4 hover:underline dark:text-sky-300"
              >
                Забыли пароль?
              </Link>
            </div>

            <AuthPrimaryButton type="submit" disabled={loading || !isFormReady}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Войти
            </AuthPrimaryButton>
          </form>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

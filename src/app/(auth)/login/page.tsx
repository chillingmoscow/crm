"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { isRateLimited, RATE_LIMIT_MESSAGE } from "@/lib/auth/auth-errors";
import { Button } from "@/components/ui/button";
import { useAuthLeave } from "../_components/auth-shell";
import {
  AuthAlert,
  AuthHeader,
  AuthPasswordField,
  AuthTextField,
  authLinkClass,
} from "../_components/auth-ui";

const loginSchema = z.object({
  email: z.string().email("Проверьте адрес почты"),
  password: z.string().min(1, "Введите пароль"),
});

type LoginForm = z.infer<typeof loginSchema>;

/** Ошибки, с которыми на вход возвращают /auth/callback и /auth/confirm. */
const URL_ERRORS: Record<string, string> = {
  auth_callback_error: "Ссылка устарела или уже использована. Войдите с паролем или запросите новую ссылку.",
};

export default function LoginPage() {
  const leave = useAuthLeave();
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // `?error=` читаем после монтирования, а не через useSearchParams: так
  // страница не требует Suspense и не мигает пустой формой.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code && URL_ERRORS[code]) setGlobalError(URL_ERRORS[code]);
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setGlobalError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login credentials")) {
        setGlobalError("Неверная почта или пароль");
      } else if (isRateLimited(error)) {
        setGlobalError(RATE_LIMIT_MESSAGE);
      } else if (msg.includes("email not confirmed")) {
        setGlobalError("Почта не подтверждена. Проверьте входящие.");
      } else {
        setGlobalError("Не удалось войти. Попробуйте ещё раз.");
      }
      setLoading(false);
      return;
    }

    // Кнопка остаётся в состоянии загрузки, пока страница гаснет.
    leave("/dashboard");
  };

  return (
    <>
      <AuthHeader
        title="Вход в аккаунт"
        description="Рады видеть вас снова"
      />

      {globalError && <AuthAlert>{globalError}</AuthAlert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <AuthTextField
          id="email"
          label="Почта"
          type="email"
          placeholder="name@example.com"
          autoComplete="email"
          registration={register("email")}
          error={errors.email?.message}
        />
        <AuthPasswordField
          id="password"
          label="Пароль"
          autoComplete="current-password"
          registration={register("password")}
          error={errors.password?.message}
          aside={
            <Link href="/forgot-password" className={authLinkClass}>
              Забыли пароль?
            </Link>
          }
        />
        <Button type="submit" disabled={loading} className="w-full">
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Войти
        </Button>
      </form>

      {/* Ссылка на регистрацию скрыта: самостоятельная регистрация
          отключена, пользователей заводят по приглашению. Чтобы вернуть:
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Нет аккаунта? <Link href="/register" className={authLinkClass}>Зарегистрироваться</Link>
          </p> */}
    </>
  );
}

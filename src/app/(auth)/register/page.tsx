"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AuthAlert,
  AuthHeader,
  AuthPasswordField,
  AuthTextField,
  PasswordStrength,
  authLinkClass,
} from "../_components/auth-ui";

const PASSWORD_RULE = "Минимум 8 символов и 2 цифры";

const registerSchema = z
  .object({
    full_name: z.string().min(2, "Введите имя"),
    phone: z.string().min(10, "Введите номер телефона"),
    email: z.string().email("Проверьте адрес почты"),
    password: z
      .string()
      .min(8, PASSWORD_RULE)
      .regex(/(?:\D*\d){2}/, "Минимум 2 цифры в пароле"),
    confirm_password: z.string(),
    agree_to_terms: z.boolean().refine((v) => v === true, "Нужно согласие"),
    subscribe_newsletter: z.boolean().optional(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Пароли не совпадают",
    path: ["confirm_password"],
  });

type RegisterForm = z.infer<typeof registerSchema>;

function AlreadyRegistered() {
  return (
    <>
      Эта почта уже зарегистрирована.{" "}
      <Link href="/login" className="font-medium underline underline-offset-4">
        Войдите
      </Link>{" "}
      или{" "}
      <Link href="/forgot-password" className="font-medium underline underline-offset-4">
        восстановите пароль
      </Link>
      .
    </>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<ReactNode | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: { agree_to_terms: false, subscribe_newsletter: false },
  });

  const password = watch("password") ?? "";
  const agreeToTerms = watch("agree_to_terms");
  const subscribe = watch("subscribe_newsletter");

  const onSubmit = async (data: RegisterForm) => {
    setLoading(true);
    setGlobalError(null);
    const supabase = createClient();
    const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const emailRedirectBase = publicSiteUrl || window.location.origin;

    const parts = data.full_name.trim().split(/\s+/);
    const first_name = parts[0] ?? "";
    const last_name = parts.slice(1).join(" ");

    const { data: signUpData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${emailRedirectBase}/auth/callback?next=/email-confirmed`,
        data: { first_name, last_name, phone: data.phone },
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      setGlobalError(
        msg.includes("already registered") || msg.includes("user already exists") ? (
          <AlreadyRegistered />
        ) : (
          "Не удалось зарегистрироваться. Попробуйте ещё раз."
        ),
      );
      setLoading(false);
      return;
    }

    // Для подтверждённой почты Supabase отвечает без ошибки, но с пустыми identities.
    if (signUpData?.user && signUpData.user.identities?.length === 0) {
      setGlobalError(<AlreadyRegistered />);
      setLoading(false);
      return;
    }

    toast.success("Проверьте почту, чтобы подтвердить аккаунт");
    router.push(`/verify-email?email=${encodeURIComponent(data.email)}`);
  };

  return (
    <>
      <AuthHeader title="Регистрация" description="Аккаунт для вашего заведения" />

      {globalError && <AuthAlert>{globalError}</AuthAlert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <AuthTextField
          id="full_name"
          label="Имя"
          autoComplete="name"
          registration={register("full_name")}
          error={errors.full_name?.message}
        />
        <AuthTextField
          id="phone"
          label="Телефон"
          type="tel"
          placeholder="+7 999 000-00-00"
          autoComplete="tel"
          registration={register("phone")}
          error={errors.phone?.message}
        />
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
          autoComplete="new-password"
          registration={register("password")}
          error={errors.password?.message}
          hint={
            errors.password ? undefined : (
              <PasswordStrength password={password} rule={PASSWORD_RULE} />
            )
          }
        />
        <AuthPasswordField
          id="confirm_password"
          label="Повторите пароль"
          autoComplete="new-password"
          registration={register("confirm_password")}
          error={errors.confirm_password?.message}
        />

        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="agree_to_terms"
              checked={agreeToTerms ?? false}
              onCheckedChange={(v) =>
                setValue("agree_to_terms", v === true, { shouldValidate: !!errors.agree_to_terms })
              }
              aria-invalid={errors.agree_to_terms ? true : undefined}
              aria-describedby={errors.agree_to_terms ? "agree_to_terms-error" : undefined}
              className="mt-0.5"
            />
            <Label htmlFor="agree_to_terms" className="font-normal leading-snug">
              Даю согласие на обработку{" "}
              <Link href="#" className={authLinkClass}>
                персональных данных
              </Link>
            </Label>
          </div>
          {errors.agree_to_terms && (
            <p id="agree_to_terms-error" role="alert" className="pl-6 text-xs text-destructive">
              {errors.agree_to_terms.message}
            </p>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id="subscribe_newsletter"
              checked={subscribe ?? false}
              onCheckedChange={(v) => setValue("subscribe_newsletter", v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="subscribe_newsletter" className="font-normal leading-snug">
              Получать новости Sheerly на почту
            </Label>
          </div>
        </div>

        <Button type="submit" disabled={loading} className="w-full">
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Продолжить
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Уже есть аккаунт?{" "}
        <Link href="/login" className={authLinkClass}>
          Войти
        </Link>
      </p>
    </>
  );
}

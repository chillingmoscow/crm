"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  ShieldPlus,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { registerHero } from "@/components/auth/auth-content";
import {
  AuthCard,
  AuthField,
  AuthNotice,
  AuthPasswordMeter,
  AuthPrimaryButton,
  AuthShell,
} from "@/components/auth/auth-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type PasswordTone = "weak" | "medium" | "good" | "strong";

const registerSchema = z
  .object({
    full_name: z.string().min(2, "Введите имя"),
    email: z.string().email("Проверьте правильность email"),
    password: z
      .string()
      .min(8, "Минимум 8 символов и 2 цифры")
      .regex(/(?:\D*\d){2}/, "Минимум 2 цифры в пароле"),
    confirm_password: z.string(),
    agree_to_terms: z.boolean().refine((value) => value === true, "Нужно подтвердить согласие"),
    subscribe_newsletter: z.boolean().optional(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Пароли не совпадают",
    path: ["confirm_password"],
  });

type RegisterForm = z.infer<typeof registerSchema>;

function getPasswordStrength(password: string): {
  level: number;
  label: string;
  tone: PasswordTone;
} {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) {
    return { level: 1, label: "Слабый пароль. Добавьте цифры, буквы разного регистра или символ.", tone: "weak" };
  }

  if (score <= 3) {
    return { level: 2, label: "Средний пароль. Уже лучше, но можно усилить.", tone: "medium" };
  }

  if (score <= 4) {
    return { level: 3, label: "Хороший пароль. Осталось совсем немного до сильного уровня.", tone: "good" };
  }

  return { level: 4, label: "Надёжный пароль.", tone: "strong" };
}

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
    defaultValues: {
      agree_to_terms: false,
      subscribe_newsletter: false,
    },
  });

  const fullName = watch("full_name") ?? "";
  const email = watch("email") ?? "";
  const password = watch("password") ?? "";
  const confirmPassword = watch("confirm_password") ?? "";
  const agreeToTerms = watch("agree_to_terms");
  const passwordStrength = getPasswordStrength(password);

  const isFormReady =
    fullName.trim().length >= 2 &&
    email.includes("@") &&
    password.length >= 8 &&
    confirmPassword.length > 0 &&
    agreeToTerms === true;

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
        data: { first_name, last_name },
      },
    });

    if (error) {
      const message = error.message.toLowerCase();

      if (message.includes("already registered") || message.includes("user already exists")) {
        setGlobalError(
          <>
            Этот email уже зарегистрирован.{" "}
            <Link href="/login" className="font-medium underline">
              Войдите
            </Link>{" "}
            или{" "}
            <Link href="/forgot-password" className="font-medium underline">
              восстановите пароль
            </Link>
            .
          </>
        );
      } else {
        setGlobalError("Не удалось создать аккаунт. Попробуйте ещё раз.");
      }

      setLoading(false);
      return;
    }

    if (signUpData?.user && signUpData.user.identities?.length === 0) {
      setGlobalError(
        <>
          Этот email уже зарегистрирован.{" "}
          <Link href="/login" className="font-medium underline">
            Войдите
          </Link>{" "}
          или{" "}
          <Link href="/forgot-password" className="font-medium underline">
            восстановите пароль
          </Link>
          .
        </>
      );
      setLoading(false);
      return;
    }

    toast.success("Письмо для подтверждения уже в пути.");
    router.push(`/verify-email?email=${encodeURIComponent(data.email)}`);
  };

  return (
    <AuthShell hero={registerHero}>
      <AuthCard
        badge="Workspace access"
        icon={<ShieldPlus className="h-5 w-5" />}
        title="Создать рабочий аккаунт"
        description="Минимум полей, понятные правила пароля и чистый переход к подтверждению почты."
        footer={
          <p className="text-center">
            Уже зарегистрированы?{" "}
            <Link
              href="/login"
              className="font-medium text-slate-900 underline-offset-4 hover:underline dark:text-white"
            >
              Войти
            </Link>
          </p>
        }
      >
        <div className="space-y-5">
          {globalError ? <AuthNotice variant="error">{globalError}</AuthNotice> : null}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthField
              label="Ваше имя"
              placeholder="Иван Петров"
              autoComplete="name"
              error={errors.full_name?.message}
              icon={<User className="h-4 w-4" />}
              {...register("full_name")}
            />

            <AuthField
              label="Рабочая почта"
              type="email"
              placeholder="name@company.ru"
              autoComplete="email"
              error={errors.email?.message}
              icon={<Mail className="h-4 w-4" />}
              {...register("email")}
            />

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
                label={password ? passwordStrength.label : "Минимум 8 символов и 2 цифры."}
                level={passwordStrength.level}
                tone={passwordStrength.tone}
              />
            </div>

            <AuthField
              label="Повторите пароль"
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

            <div className="space-y-3 rounded-[24px] border border-slate-200/70 bg-slate-50/80 p-4 dark:border-white/8 dark:bg-white/5">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="agree_to_terms"
                  checked={agreeToTerms ?? false}
                  onCheckedChange={(value) =>
                    setValue("agree_to_terms", value === true, { shouldValidate: true })
                  }
                  className="mt-0.5 rounded-md border-slate-300 data-[state=checked]:border-sky-500 data-[state=checked]:bg-sky-500 dark:border-white/15 dark:data-[state=checked]:border-sky-400 dark:data-[state=checked]:bg-sky-400"
                />
                <Label
                  htmlFor="agree_to_terms"
                  className="cursor-pointer text-sm leading-6 text-slate-600 dark:text-slate-300"
                >
                  Подтверждаю согласие на обработку{" "}
                  <span className="font-medium text-sky-700 underline dark:text-sky-300">
                    персональных данных
                  </span>
                  .
                </Label>
              </div>

              {errors.agree_to_terms ? (
                <p className="pl-7 text-sm text-red-600 dark:text-red-300">
                  {errors.agree_to_terms.message}
                </p>
              ) : null}

              <div className="flex items-start gap-3">
                <Checkbox
                  id="subscribe_newsletter"
                  onCheckedChange={(value) =>
                    setValue("subscribe_newsletter", value === true, { shouldDirty: true })
                  }
                  className="mt-0.5 rounded-md border-slate-300 data-[state=checked]:border-sky-500 data-[state=checked]:bg-sky-500 dark:border-white/15 dark:data-[state=checked]:border-sky-400 dark:data-[state=checked]:bg-sky-400"
                />
                <Label
                  htmlFor="subscribe_newsletter"
                  className="cursor-pointer text-sm leading-6 text-slate-600 dark:text-slate-300"
                >
                  Получать редкие обновления о продукте и улучшениях доступа.
                </Label>
              </div>
            </div>

            <AuthPrimaryButton type="submit" disabled={loading || !isFormReady}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Продолжить
            </AuthPrimaryButton>
          </form>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Mail, MailCheck, ShieldAlert } from "lucide-react";

import { recoveryHero } from "@/components/auth/auth-content";
import {
  AuthBackLink,
  AuthCard,
  AuthField,
  AuthNotice,
  AuthPrimaryButton,
  AuthShell,
  AuthStatusCard,
} from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/client";

const forgotSchema = z.object({
  email: z.string().email("Проверьте правильность email"),
});

type ForgotForm = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");
  const [globalError, setGlobalError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const email = watch("email") ?? "";
  const isFormReady = email.includes("@");

  const doSendReset = async (targetEmail: string) => {
    const supabase = createClient();
    const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const redirectBase = publicSiteUrl || window.location.origin;

    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${redirectBase}/reset-password`,
    });

    return error;
  };

  const onSubmit = async (data: ForgotForm) => {
    setLoading(true);
    setGlobalError(null);

    const error = await doSendReset(data.email);

    if (error) {
      setGlobalError("Не удалось отправить письмо для сброса. Попробуйте ещё раз.");
      setLoading(false);
      return;
    }

    setSentEmail(data.email);
    setSent(true);
    setLoading(false);
  };

  const onResend = async () => {
    setResendLoading(true);
    setGlobalError(null);
    const error = await doSendReset(sentEmail);

    if (error) {
      setGlobalError("Не удалось отправить письмо повторно. Попробуйте чуть позже.");
    }

    setResendLoading(false);
  };

  if (sent) {
    return (
      <AuthShell hero={recoveryHero}>
        <AuthStatusCard
          badge="Recovery email"
          icon={<MailCheck className="h-5 w-5" />}
          title="Проверьте почту"
          description={
            <>
              Мы отправили ссылку для сброса пароля на{" "}
              <span className="font-medium text-slate-900 dark:text-white">{sentEmail}</span>.
            </>
          }
          actions={
            <>
              <AuthPrimaryButton
                type="button"
                onClick={onResend}
                disabled={resendLoading}
                className="max-w-full sm:max-w-[320px]"
              >
                {resendLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Отправить письмо повторно
              </AuthPrimaryButton>
              <AuthBackLink>Вернуться ко входу</AuthBackLink>
            </>
          }
        >
          {globalError ? <AuthNotice variant="error">{globalError}</AuthNotice> : null}
          <AuthNotice>
            Если письма нет в течение пары минут, проверьте папку «Спам» или запросите новую ссылку.
          </AuthNotice>
        </AuthStatusCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell hero={recoveryHero}>
      <AuthCard
        badge="Password recovery"
        icon={<ShieldAlert className="h-5 w-5" />}
        title="Восстановить пароль"
        description="Введите рабочую почту, и мы отправим ссылку для безопасного обновления пароля."
        footer={
          <div className="text-center">
            <AuthBackLink>Вернуться ко входу</AuthBackLink>
          </div>
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

            <AuthPrimaryButton type="submit" disabled={loading || !isFormReady}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Отправить ссылку
            </AuthPrimaryButton>
          </form>

          <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
            Нужен новый аккаунт?{" "}
            <Link
              href="/register"
              className="font-medium text-slate-900 underline-offset-4 hover:underline dark:text-white"
            >
              Создать доступ
            </Link>
            .
          </p>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MailCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { isRateLimited, RATE_LIMIT_MESSAGE } from "@/lib/auth/auth-errors";
import { Button } from "@/components/ui/button";
import {
  AuthAlert,
  AuthHeader,
  AuthTextField,
  BackToLogin,
  authLinkClass,
} from "../_components/auth-ui";

const forgotSchema = z.object({
  email: z.string().email("Проверьте адрес почты"),
});

type ForgotForm = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<
    { ok: boolean; text: string } | null
  >(null);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  // Возвращает ошибку Supabase (или null): без неё экран «Проверьте почту»
  // показался бы и тогда, когда письмо не ушло (лимит, неверный адрес
  // возврата, сбой), и человек ждал бы письмо, которого нет.
  const doSendReset = async (email: string) => {
    const supabase = createClient();
    // NEXT_PUBLIC_SITE_URL, если задан: ссылка в письме ведёт на боевой
    // адрес, даже если форму открыли на другом (превью, локально).
    const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const redirectBase = publicSiteUrl || window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${redirectBase}/reset-password`,
    });
    return error;
  };

  const onSubmit = async (data: ForgotForm) => {
    setLoading(true);
    setGlobalError(null);
    const error = await doSendReset(data.email);
    setLoading(false);
    if (error) {
      setGlobalError(
        isRateLimited(error) ? RATE_LIMIT_MESSAGE : "Не удалось отправить письмо. Попробуйте ещё раз.",
      );
      return;
    }
    setSentEmail(data.email);
  };

  const onResend = async () => {
    if (!sentEmail) return;
    setResendLoading(true);
    setResendNotice(null);
    const error = await doSendReset(sentEmail);
    setResendNotice(
      error
        ? {
            ok: false,
            text: isRateLimited(error)
              ? RATE_LIMIT_MESSAGE
              : "Не удалось отправить письмо повторно. Попробуйте чуть позже.",
          }
        : { ok: true, text: "Письмо отправлено повторно" },
    );
    setResendLoading(false);
  };

  if (sentEmail) {
    return (
      <div className="motion-rise">
        <AuthHeader
          icon={<MailCheck />}
          title="Проверьте почту"
          description={
            <>
              Ссылка для нового пароля отправлена на{" "}
              <span className="font-medium text-foreground">{sentEmail}</span>
            </>
          }
        />
        <p className="text-sm text-muted-foreground">
          Письма нет?{" "}
          <button
            type="button"
            onClick={onResend}
            disabled={resendLoading}
            className={`${authLinkClass} disabled:opacity-50`}
          >
            {resendLoading ? "Отправляем…" : "Отправить ещё раз"}
          </button>
        </p>
        {resendNotice && (
          <p
            role="status"
            className={
              resendNotice.ok
                ? "mt-2 text-sm text-emerald-700 dark:text-emerald-400"
                : "mt-2 text-sm text-destructive"
            }
          >
            {resendNotice.text}
          </p>
        )}
        <BackToLogin />
      </div>
    );
  }

  return (
    <>
      <AuthHeader
        title="Забыли пароль?"
        description="Введите почту, и мы пришлём ссылку для нового пароля."
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
        <Button type="submit" disabled={loading} className="w-full">
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Отправить ссылку
        </Button>
      </form>

      <BackToLogin />
    </>
  );
}

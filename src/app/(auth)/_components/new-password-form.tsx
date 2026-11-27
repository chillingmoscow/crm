"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PASSWORD_MIN_LENGTH, PASSWORD_TWO_LETTERS } from "@/lib/auth/password";
import {
  AuthAlert,
  AuthHeader,
  AuthPasswordField,
  PasswordStrength,
} from "./auth-ui";

const PASSWORD_RULE = "Минимум 8 символов и 2 буквы";
const PASSWORD_RULES = [PASSWORD_MIN_LENGTH, PASSWORD_TWO_LETTERS];

const schema = z
  .object({
    password: z
      .string()
      .refine(PASSWORD_MIN_LENGTH.test, PASSWORD_RULE)
      .refine(PASSWORD_TWO_LETTERS.test, PASSWORD_RULE),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Пароли не совпадают",
    path: ["confirm_password"],
  });

type NewPasswordValues = z.infer<typeof schema>;

/**
 * Новый пароль: при восстановлении по ссылке из письма и при первом входе
 * по приглашению. `onSave` возвращает текст ошибки или `null`.
 */
export function NewPasswordForm({
  title,
  description,
  submitLabel,
  ready,
  error: initialError,
  email,
  onSave,
}: {
  title: string;
  description: string;
  submitLabel: string;
  /** Ссылка проверена, пароль можно сохранять. */
  ready: boolean;
  error?: string | null;
  /** Почта аккаунта — для менеджера паролей (скрытое поле username). */
  email?: string | null;
  onSave: (password: string) => Promise<string | null>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NewPasswordValues>({
    resolver: zodResolver(schema),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const password = watch("password") ?? "";

  const onSubmit = async (data: NewPasswordValues) => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    const message = await onSave(data.password);
    if (message) {
      setError(message);
      setLoading(false);
    }
  };

  const shownError = error ?? initialError;

  return (
    <>
      <AuthHeader icon={<KeyRound />} title={title} description={description} />

      {shownError && <AuthAlert>{shownError}</AuthAlert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {/* Менеджер паролей сохраняет новый пароль к этой почте, а не
            к пустому логину. */}
        {email && (
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        )}
        <AuthPasswordField
          id="password"
          label="Новый пароль"
          autoComplete="new-password"
          registration={register("password")}
          error={errors.password?.message}
          hint={
            errors.password ? undefined : (
              <PasswordStrength password={password} rule={PASSWORD_RULE} rules={PASSWORD_RULES} />
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
        <Button type="submit" disabled={loading || !ready} className="w-full">
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
      </form>
    </>
  );
}

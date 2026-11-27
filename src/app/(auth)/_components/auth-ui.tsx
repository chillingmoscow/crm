"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { UseFormRegisterReturn } from "react-hook-form";
import { AlertCircle, ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { statusTones, type StatusTone } from "@/components/ui/status-badge";

/**
 * Заголовок формы входа: необязательная иконка, заголовок 28px, пояснение.
 * Иконка — готовый элемент (`icon={<MailCheck />}`), а не компонент: так её
 * можно передать и из серверной страницы.
 */
export function AuthHeader({
  icon,
  tone = "info",
  title,
  description,
  center = false,
}: {
  icon?: ReactNode;
  tone?: StatusTone;
  title: ReactNode;
  description?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cn("mb-8", center && "flex flex-col items-center text-center")}>
      {icon && (
        <span
          aria-hidden
          className={cn(
            "mb-6 flex size-12 items-center justify-center rounded-full [&_svg]:size-6",
            statusTones[tone],
          )}
        >
          {icon}
        </span>
      )}
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
      {description && (
        <p className="mt-2 text-base text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** Ошибка формы целиком (неверный пароль, устаревшая ссылка). */
export function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Ссылка в тексте формы. */
export const authLinkClass =
  "font-medium text-brand underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none";

export function BackToLogin() {
  return (
    <Link
      href="/login"
      className="mt-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Вернуться ко входу
    </Link>
  );
}

/** Ожидание проверки ссылки из письма. */
export function AuthLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

type FieldBase = {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  registration: UseFormRegisterReturn;
  autoComplete?: string;
};

/** Текстовое поле формы входа: `Field` + `Input`, связь с подписью и ошибкой. */
export function AuthTextField({
  id,
  label,
  error,
  hint,
  registration,
  autoComplete,
  type = "text",
  placeholder,
}: FieldBase & { type?: string; placeholder?: string }) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      {(control) => (
        <Input
          {...control}
          {...registration}
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
      )}
    </Field>
  );
}

/** Поле пароля с кнопкой «Показать пароль». */
export function AuthPasswordField({
  id,
  label,
  error,
  hint,
  registration,
  autoComplete,
  aside,
}: FieldBase & {
  /** Ссылка справа от подписи («Забыли пароль?»). */
  aside?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      {aside && <div className="absolute right-0 top-0 text-sm">{aside}</div>}
      <Field id={id} label={label} error={error} hint={hint}>
        {(control) => (
          <div className="relative">
            <Input
              {...control}
              {...registration}
              type={shown ? "text" : "password"}
              autoComplete={autoComplete}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShown((v) => !v)}
              aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
              aria-pressed={shown}
              data-tip={shown ? "Скрыть пароль" : "Показать пароль"}
              className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        )}
      </Field>
    </div>
  );
}

const STRENGTH = [
  { label: "Слабый пароль", bar: "bg-destructive", text: "text-destructive" },
  { label: "Средний пароль", bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  { label: "Хороший пароль", bar: "bg-brand", text: "text-brand" },
  { label: "Надёжный пароль", bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
] as const;

/** Оценка пароля 1–4 по длине и разнообразию символов. */
export function passwordStrength(password: string): 1 | 2 | 3 | 4 | null {
  if (!password) return null;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/\p{Lu}/u.test(password) && /\p{Ll}/u.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^\p{L}\d]/u.test(password)) score++;
  if (score <= 1) return 1;
  if (score === 2) return 2;
  if (score === 3) return 3;
  return 4;
}

/** Полоска надёжности пароля под полем; без пароля — правило пароля. */
export function PasswordStrength({ password, rule }: { password: string; rule: string }) {
  const level = passwordStrength(password);
  const spec = level ? STRENGTH[level - 1] : null;
  return (
    <span className="grid gap-1">
      <span className="block h-1 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full transition-[width,background-color] duration-300 ease-[var(--ease-soft)]",
            spec?.bar,
          )}
          style={{ width: level ? `${level * 25}%` : "0%" }}
        />
      </span>
      <span className={spec?.text}>{spec ? spec.label : rule}</span>
    </span>
  );
}

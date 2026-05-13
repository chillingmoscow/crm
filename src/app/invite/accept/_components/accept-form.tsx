/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, KeyRound, Loader2, PartyPopper } from "lucide-react";
import { toast } from "sonner";

import { acceptInvitation } from "../actions";

interface Props {
  token: string;
  email: string;
  venueName: string;
  accountName: string | null;
  roleName: string;
  /** Если true — у юзера уже есть аккаунт, форма просит ВВЕСТИ существующий
   *  пароль. Иначе — просит СОЗДАТЬ пароль (с подтверждением). */
  existingUser: boolean;
}

/**
 * Форма принятия приглашения. Две схемы:
 *
 *   • existingUser=false — юзера ещё нет, создаём: пароль + подтверждение.
 *   • existingUser=true  — юзер есть, просим текущий пароль для sign-in.
 *
 * Отправляет в `acceptInvitation` server action, который сам решит что
 * делать (createUser или signInWithPassword) и accept'нет все pending
 * invitations этого email. После успеха router.push на возвращённый
 * redirect (`/profile?welcome=1` или `/dashboard`).
 */
export function AcceptForm({
  token,
  email,
  venueName,
  accountName,
  roleName,
  existingUser,
}: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();

  const minLen = 6;
  const passwordOk = password.length >= minLen;
  const confirmOk = existingUser || password === confirm;
  const canSubmit = passwordOk && confirmOk && !isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await acceptInvitation(token, password);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      // Сообщения «успех» не нужно — router.push отрисует следующий
      // экран (/profile?welcome=1 покажет welcome-баннер).
      if (result.redirect) router.replace(result.redirect);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-50 px-6">
      <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-10" />

      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 mb-5 mx-auto">
          <PartyPopper className="w-6 h-6 text-blue-600" />
        </div>

        <h1 className="text-[24px] leading-[32px] font-semibold text-gray-900 text-center mb-2">
          Вас приглашают в {venueName}
        </h1>
        <p className="text-[14px] leading-[20px] text-gray-500 text-center mb-1">
          {existingUser
            ? "Введите ваш пароль, чтобы принять приглашение"
            : "Создайте пароль, чтобы завершить регистрацию"}
        </p>
        <p className="text-[13px] leading-[18px] text-gray-400 text-center mb-7">
          {email} · {roleName}
          {accountName ? ` · ${accountName}` : ""}
        </p>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {/* Password */}
          <div className="relative">
            <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={existingUser ? "Ваш пароль" : "Придумайте пароль"}
              autoComplete={existingUser ? "current-password" : "new-password"}
              className="w-full h-12 pl-10 pr-10 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-900 outline-none focus:border-blue-500 focus:bg-white transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {password && !passwordOk && (
            <p className="text-xs text-red-500 pl-1 -mt-2">
              Пароль должен быть не короче {minLen} символов
            </p>
          )}

          {/* Confirm password (только для нового юзера) */}
          {!existingUser && (
            <>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Повторите пароль"
                  autoComplete="new-password"
                  className="w-full h-12 pl-10 pr-4 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-900 outline-none focus:border-blue-500 focus:bg-white transition-colors"
                />
              </div>
              {confirm && !confirmOk && (
                <p className="text-xs text-red-500 pl-1 -mt-2">
                  Пароли не совпадают
                </p>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="h-12 mt-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {existingUser ? "Войти и принять приглашение" : "Создать аккаунт"}
          </button>
        </form>

        {existingUser && (
          <p className="text-[12px] leading-[18px] text-center text-gray-400 mt-5">
            Забыли пароль?{" "}
            <Link
              href={`/forgot-password?email=${encodeURIComponent(email)}`}
              className="text-blue-600 hover:underline"
            >
              Восстановить
            </Link>
            {" "}и вернитесь по ссылке из письма-приглашения.
          </p>
        )}
      </div>

      <p className="text-[11px] text-gray-400 mt-8">
        Sheerly · CRM для HoReCa
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveQuickRestoBackOfficeCredentials } from "../actions";

interface Props {
  accountId: string | null;
  connectionId: string | null;
  initialLogin?: string | null;
  stepLabel?: string;
  onBack: () => void;
  onSkipIntegration?: () => void;
  onNext: (payload: { login: string }) => void;
}

export function StepQuickRestoBackOfficeCredentials({
  accountId,
  connectionId,
  initialLogin,
  stepLabel = "Шаг 7",
  onBack,
  onSkipIntegration,
  onNext,
}: Props) {
  const [login, setLogin] = useState(initialLogin ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!login.trim() || !password.trim()) {
      toast.error("Введите логин и пароль back-office пользователя");
      return;
    }

    setLoading(true);
    const result = await saveQuickRestoBackOfficeCredentials({
      accountId,
      connectionId,
      login: login.trim(),
      password,
    });
    setLoading(false);

    if (!result.ok) {
      toast.error(result.error ?? "Не удалось проверить back-office доступ");
      return;
    }

    toast.success("Back-office доступ Quick Resto проверен");
    onNext({ login: login.trim() });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{stepLabel}</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Доступ Sheerly Bot</h1>
        <p className="text-sm text-gray-500">
          Введите логин и пароль back-office пользователя Sheerly Bot. Мы проверим авторизацию и сохраним
          сессионные cookies, чтобы работать со строками актов, которые Quick Resto не открывает через публичный API.
        </p>
      </div>

      <div className="px-8 py-6 space-y-4">
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900">
          Используйте отдельного пользователя Sheerly Bot, а не учетную запись владельца. Права этого пользователя
          должны быть ограничены должностью Sheerly.
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Логин бэк-офиса</label>
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="sheerly.bot"
            className="h-12 w-full rounded-xl border border-gray-200 px-4 text-sm placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Пароль бэк-офиса</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            className="h-12 w-full rounded-xl border border-gray-200 px-4 text-sm placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      <div className="px-8 pb-8 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="h-12 flex-1 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Назад
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={handleContinue}
          className="h-12 flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Проверить и продолжить
        </button>
      </div>
      {onSkipIntegration ? (
        <div className="px-8 pb-8 -mt-4">
          <button
            type="button"
            onClick={onSkipIntegration}
            className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
          >
            Пропустить интеграцию и заполнить вручную
          </button>
        </div>
      ) : null}
    </div>
  );
}

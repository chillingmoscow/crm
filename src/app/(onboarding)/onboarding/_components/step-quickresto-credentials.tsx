"use client";

import { useState } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { saveQuickRestoCredentials, testQuickRestoConnection } from "../actions";

interface Props {
  accountId: string | null;
  initialLogin: string;
  stepLabel?: string;
  onBack: () => void;
  onSkipIntegration?: () => void;
  onNext: (payload: { login: string; connectionId: string }) => void;
}

export function StepQuickRestoCredentials({
  accountId,
  initialLogin,
  stepLabel = "Шаг 4",
  onBack,
  onSkipIntegration,
  onNext,
}: Props) {
  const [login, setLogin] = useState(initialLogin);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!accountId) {
      toast.error("Сначала создайте аккаунт");
      return;
    }
    if (!login.trim() || !password.trim()) {
      toast.error("Введите логин и пароль Quick Resto");
      return;
    }

    setLoading(true);

    const saved = await saveQuickRestoCredentials({
      accountId,
      login: login.trim(),
      password: password.trim(),
    });

    if (saved.error || !saved.connectionId) {
      setLoading(false);
      toast.error(saved.error ?? "Не удалось сохранить подключение");
      return;
    }

    const tested = await testQuickRestoConnection({ connectionId: saved.connectionId });
    setLoading(false);

    if (!tested.ok) {
      toast.error(tested.error ?? "Не удалось подключиться к Quick Resto");
      return;
    }

    toast.success("Подключение к Quick Resto успешно");
    onNext({ login: login.trim(), connectionId: saved.connectionId });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <PlugZap className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{stepLabel}</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Подключение Quick Resto</h1>
        <p className="text-sm text-gray-500">Введите данные API-доступа. Их можно найти в Quick Resto: Предприятие → Настройки.</p>
      </div>

      <div className="px-8 py-6 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Логин для API</label>
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="fb417"
            className="h-12 w-full rounded-xl border border-gray-200 px-4 text-sm placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Пароль для API</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-12 w-full rounded-xl border border-gray-200 px-4 text-sm placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      <div className="px-8 pb-8 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="h-12 flex-1 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
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

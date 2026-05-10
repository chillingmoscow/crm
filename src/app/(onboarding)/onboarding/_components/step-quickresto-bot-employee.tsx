"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { verifyQuickRestoBotEmployee } from "../actions";

interface Props {
  accountId: string | null;
  connectionId: string | null;
  roleExternalId: number | null;
  stepLabel?: string;
  onBack: () => void;
  onSkipIntegration?: () => void;
  onNext: (payload: { employeeId: number; login: string | null }) => void;
}

export function StepQuickRestoBotEmployee({
  accountId,
  connectionId,
  roleExternalId,
  stepLabel = "Шаг 6",
  onBack,
  onSkipIntegration,
  onNext,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    ok: boolean;
    employeeId: number | null;
    employeeName: string | null;
    roleTitle: string | null;
    login: string | null;
    error: string | null;
  } | null>(null);

  const handleCheck = async () => {
    setLoading(true);
    const result = await verifyQuickRestoBotEmployee({ accountId, connectionId, roleExternalId });
    setLoading(false);
    setCheckResult(result);

    if (!result.ok || !result.employeeId) {
      toast.error(result.error ?? "Не удалось проверить сотрудника Sheerly Bot");
      return;
    }

    toast.success("Сотрудник Sheerly Bot найден");
    onNext({ employeeId: result.employeeId, login: result.login });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <UserCog className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{stepLabel}</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Сотрудник Sheerly Bot</h1>
        <p className="text-sm text-gray-500">
          Создайте отдельного сотрудника для сервисного доступа. Так действия Sheerly будут отделены от владельца
          и ограничены правами должности.
        </p>
      </div>

      <div className="px-8 py-6 space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-700 space-y-3">
          <p className="font-medium text-gray-900">В Quick Resto создайте сотрудника «Sheerly Bot».</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Откройте Персонал → Сотрудники.</li>
            <li>Создайте сотрудника с именем Sheerly Bot.</li>
            <li>Назначьте ему должность Sheerly.</li>
            <li>Создайте для него пользователя бэк-офиса с логином и паролем.</li>
          </ol>
        </div>

        {checkResult?.ok ? (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-xs text-green-800">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p>Найден: {checkResult.employeeName}</p>
                <p>Должность: {checkResult.roleTitle}</p>
                {checkResult.login ? <p>Логин бэк-офиса: {checkResult.login}</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {checkResult && !checkResult.ok ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{checkResult.error}</p>
            </div>
          </div>
        ) : null}
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
          onClick={handleCheck}
          className="h-12 flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Проверить сотрудника
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

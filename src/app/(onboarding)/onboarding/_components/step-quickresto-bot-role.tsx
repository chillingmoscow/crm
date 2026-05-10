"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { verifyQuickRestoBotRole } from "../actions";

interface Props {
  accountId: string | null;
  connectionId: string | null;
  stepLabel?: string;
  onBack: () => void;
  onSkipIntegration?: () => void;
  onNext: (payload: { roleId: number }) => void;
}

const REQUIRED_RIGHTS = [
  "Приходные накладные",
  "Расходные накладные",
  "Внутренние перемещения",
  "Акты списания",
  "Акты приготовления",
  "Акты разбора",
  "Акты переработки",
  "Акты инвентаризации",
];

export function StepQuickRestoBotRole({
  accountId,
  connectionId,
  stepLabel = "Шаг 5",
  onBack,
  onSkipIntegration,
  onNext,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    ok: boolean;
    roleId: number | null;
    missingRights: Array<{ code: string; label: string }>;
    backOfficeUser: boolean;
    error: string | null;
  } | null>(null);

  const handleCheck = async () => {
    setLoading(true);
    const result = await verifyQuickRestoBotRole({ accountId, connectionId });
    setLoading(false);
    setCheckResult(result);

    if (!result.ok || !result.roleId) {
      toast.error(result.error ?? "Не удалось проверить должность Sheerly");
      return;
    }

    toast.success("Должность Sheerly найдена и права подходят");
    onNext({ roleId: result.roleId });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{stepLabel}</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Должность для Sheerly</h1>
        <p className="text-sm text-gray-500">
          Публичный API Quick Resto не дает менять строки актов инвентаризации. Поэтому нужен отдельный
          ограниченный back-office пользователь, от имени которого Sheerly сможет работать с содержимым актов.
        </p>
      </div>

      <div className="px-8 py-6 space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-700 space-y-3">
          <p className="font-medium text-gray-900">В Quick Resto создайте должность «Sheerly».</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Откройте Персонал → Должности.</li>
            <li>Создайте должность с названием Sheerly.</li>
            <li>Включите доступ к бэк-офису.</li>
            <li>В разделе «Складские документы» поставьте режим «Изменение» для нужных документов.</li>
          </ol>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Проверяемые права</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {REQUIRED_RIGHTS.map((right) => (
                <div key={right} className="flex items-center gap-2 text-xs text-gray-600">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  {right}
                </div>
              ))}
            </div>
          </div>
        </div>

        {checkResult && !checkResult.ok ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p>{checkResult.error}</p>
                {!checkResult.backOfficeUser ? <p>Не включен доступ к бэк-офису.</p> : null}
                {checkResult.missingRights.length > 0 ? (
                  <div>
                    <p>Не хватает прав:</p>
                    <ul className="list-disc pl-5">
                      {checkResult.missingRights.map((right) => (
                        <li key={right.code}>{right.label}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
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
          Проверить должность
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

"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { runQuickRestoImport } from "../actions";

interface ImportSummary {
  venuesCreated: number;
  venuesUpdated: number;
  rolesCreated: number;
  rolesUpdated: number;
  employeeInvitationsSent: number;
  employeesAutoCreated: number;
  employeesAutoUpdated: number;
  skippedBlockedEmployees: number;
  skippedNoEmailEmployees: number;
  skippedMissingRoleEmployees: number;
  skippedNoVenueEmployees: number;
  errors: string[];
}

interface Props {
  accountId: string | null;
  connectionId: string | null;
  stepLabel?: string;
  importVenues: boolean;
  importRoles: boolean;
  importEmployees: boolean;
  selectedVenueExternalIds: number[];
  selectedRoleExternalIds: number[];
  selectedEmployeeExternalIds: number[];
  onBack: () => void;
  onSkipIntegration?: () => void;
  onDone: (payload?: { needsVenueSetup: boolean }) => void;
}

export function StepQuickRestoImport({
  accountId,
  connectionId,
  stepLabel = "Шаг 6",
  importVenues,
  importRoles,
  importEmployees,
  selectedVenueExternalIds,
  selectedRoleExternalIds,
  selectedEmployeeExternalIds,
  onBack,
  onSkipIntegration,
  onDone,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const summaryView: ImportSummary = summary ?? {
    venuesCreated: 0,
    venuesUpdated: 0,
    rolesCreated: 0,
    rolesUpdated: 0,
    employeeInvitationsSent: 0,
    employeesAutoCreated: 0,
    employeesAutoUpdated: 0,
    skippedBlockedEmployees: 0,
    skippedNoEmailEmployees: 0,
    skippedMissingRoleEmployees: 0,
    skippedNoVenueEmployees: 0,
    errors: [],
  };
  const selectedAny =
    (importVenues && selectedVenueExternalIds.length > 0) ||
    (importRoles && selectedRoleExternalIds.length > 0) ||
    (importEmployees && selectedEmployeeExternalIds.length > 0);

  const needsVenueSetup =
    summary !== null && summary.venuesCreated + summary.venuesUpdated === 0;
  const nothingSelected = !selectedAny;
  const canFinish = summary !== null;

  const handleRun = async () => {
    if (!accountId) {
      toast.error("Не найден аккаунт для импорта");
      return;
    }

    setLoading(true);
    const result = await runQuickRestoImport({
      accountId,
      connectionId,
      importVenues,
      importRoles,
      importEmployees,
      selectedVenueExternalIds,
      selectedRoleExternalIds,
      selectedEmployeeExternalIds,
    });
    setLoading(false);

    if (result.error || !result.summary) {
      toast.error(result.error ?? "Импорт завершился ошибкой");
      return;
    }

    setSummary(result.summary as ImportSummary);
    if (result.status === "success") toast.success("Импорт завершен успешно");
    else toast.warning("Импорт завершен частично");
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <PlayCircle className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{stepLabel}</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Импорт данных</h1>
        <p className="text-sm text-gray-500">Запустите импорт и дождитесь результата.</p>
      </div>

      <div className="px-8 py-6 space-y-4">
        {!summary && nothingSelected ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Для импорта не выбрано ни одной сущности.
          </div>
        ) : summary ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2 text-sm text-gray-700">
            <div className="flex items-center gap-2 text-green-700 font-medium">
              <CheckCircle2 className="w-4 h-4" /> Итог импорта
            </div>
            <p>Заведения: создано {summaryView.venuesCreated}, обновлено {summaryView.venuesUpdated}</p>
            <p>Должности: создано {summaryView.rolesCreated}, обновлено {summaryView.rolesUpdated}</p>
            <p>Сотрудники: создано {summaryView.employeesAutoCreated}, обновлено {summaryView.employeesAutoUpdated}</p>
            {summaryView.errors.length > 0 ? (
              <div>
                <p className="font-medium text-red-600">Ошибки:</p>
                <ul className="list-disc pl-5">
                  {summaryView.errors.slice(0, 8).map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : null}
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
          onClick={summary ? () => onDone({ needsVenueSetup }) : handleRun}
          disabled={summary ? (!canFinish || loading) : (nothingSelected || loading)}
          className="h-12 flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center"
        >
          {summary ? "Завершить" : (
            <>
              {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Запустить импорт
            </>
          )}
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

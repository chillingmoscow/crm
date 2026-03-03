"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { loadQuickRestoOptions } from "../actions";

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
  onUpdate: (patch: {
    importVenues?: boolean;
    importRoles?: boolean;
    importEmployees?: boolean;
    selectedVenueExternalIds?: number[];
    selectedRoleExternalIds?: number[];
    selectedEmployeeExternalIds?: number[];
  }) => void;
  onBack: () => void;
  onSkipIntegration?: () => void;
  onNext: () => void;
}

type VenueOption = { id: number; name: string; address: string };
type RoleOption = { id: number; title: string; systemRole: string | null };
type EmployeeOption = { id: number; fullName: string; blocked: boolean };
type Stage = "entities" | "venues" | "roles" | "employees";

export function StepQuickRestoOptions({
  accountId,
  connectionId,
  stepLabel = "Шаг 5",
  importVenues,
  importRoles,
  importEmployees,
  selectedVenueExternalIds,
  selectedRoleExternalIds,
  selectedEmployeeExternalIds,
  onUpdate,
  onBack,
  onSkipIntegration,
  onNext,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [stage, setStage] = useState<Stage>("entities");
  const prefilledRef = useRef(false);
  const selectedVenueCountRef = useRef(selectedVenueExternalIds.length);
  const selectedRoleCountRef = useRef(selectedRoleExternalIds.length);
  const selectedEmployeeCountRef = useRef(selectedEmployeeExternalIds.length);

  useEffect(() => {
    selectedVenueCountRef.current = selectedVenueExternalIds.length;
    selectedRoleCountRef.current = selectedRoleExternalIds.length;
    selectedEmployeeCountRef.current = selectedEmployeeExternalIds.length;
  }, [selectedVenueExternalIds.length, selectedRoleExternalIds.length, selectedEmployeeExternalIds.length]);

  useEffect(() => {
    prefilledRef.current = false;
  }, [accountId, connectionId]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (!accountId && !connectionId) {
        setLoadError("Сначала сохраните креды Quick Resto");
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      const result = await loadQuickRestoOptions({ accountId: accountId ?? undefined, connectionId });
      if (!alive) return;

      if (result.error) {
        setLoadError(result.error);
        toast.warning(result.error);
      }

      setVenues(result.venues);
      setRoles(result.roles);
      setEmployees(result.employees);

      if (!prefilledRef.current) {
        const patch: {
          selectedVenueExternalIds?: number[];
          selectedRoleExternalIds?: number[];
          selectedEmployeeExternalIds?: number[];
        } = {};

        if (selectedVenueCountRef.current === 0) {
          patch.selectedVenueExternalIds = result.venues.map((v) => v.id);
        }
        if (selectedRoleCountRef.current === 0) {
          patch.selectedRoleExternalIds = result.roles
            .filter((r) => r.systemRole === "Custom")
            .map((r) => r.id);
        }
        if (selectedEmployeeCountRef.current === 0) {
          patch.selectedEmployeeExternalIds = result.employees
            .filter((e) => !e.blocked)
            .map((e) => e.id);
        }

        if (
          patch.selectedVenueExternalIds ||
          patch.selectedRoleExternalIds ||
          patch.selectedEmployeeExternalIds
        ) {
          onUpdate(patch);
        }

        prefilledRef.current = true;
      }

      setLoading(false);
    };

    load();
    return () => {
      alive = false;
    };
  }, [
    accountId,
    connectionId,
    onUpdate,
    reloadToken,
  ]);

  const flow = useMemo<Stage[]>(() => {
    const next: Stage[] = [];
    if (importVenues) next.push("venues");
    if (importRoles) next.push("roles");
    if (importEmployees) next.push("employees");
    return next;
  }, [importEmployees, importRoles, importVenues]);

  const stageTitle = (() => {
    switch (stage) {
      case "entities":
        return "Сущности для импорта";
      case "venues":
        return "Заведения";
      case "roles":
        return "Должности";
      case "employees":
        return "Сотрудники";
      default:
        return "Что импортировать";
    }
  })();

  const stageHint = (() => {
    switch (stage) {
      case "entities":
        return "Сначала выберите типы данных, затем на отдельных шагах отметьте конкретные записи.";
      case "venues":
        return "Выберите заведения из Quick Resto, которые нужно создать в системе.";
      case "roles":
        return "Выберите должности. Обычно импортируют только пользовательские (Custom).";
      case "employees":
        return "Выберите сотрудников для переноса.";
      default:
        return "";
    }
  })();

  const toggle = (
    current: number[],
    nextId: number,
    checked: boolean,
    key: "selectedVenueExternalIds" | "selectedRoleExternalIds" | "selectedEmployeeExternalIds"
  ) => {
    const set = new Set(current);
    if (checked) set.add(nextId);
    else set.delete(nextId);
    const patch: {
      selectedVenueExternalIds?: number[];
      selectedRoleExternalIds?: number[];
      selectedEmployeeExternalIds?: number[];
    } = {};
    patch[key] = Array.from(set);
    onUpdate(patch);
  };

  const setAll = (
    key: "selectedVenueExternalIds" | "selectedRoleExternalIds" | "selectedEmployeeExternalIds",
    ids: number[]
  ) => {
    const patch: {
      selectedVenueExternalIds?: number[];
      selectedRoleExternalIds?: number[];
      selectedEmployeeExternalIds?: number[];
    } = {};
    patch[key] = ids;
    onUpdate(patch);
  };

  const goBackStage = () => {
    if (stage === "entities") {
      onBack();
      return;
    }

    const index = flow.indexOf(stage);
    if (index <= 0) {
      setStage("entities");
      return;
    }

    setStage(flow[index - 1]);
  };

  const goNextStage = () => {
    if (stage === "entities") {
      if (!importVenues && !importRoles && !importEmployees) {
        toast.error("Выберите хотя бы одну сущность");
        return;
      }

      if (flow.length === 0) {
        onNext();
        return;
      }

      setStage(flow[0]);
      return;
    }

    if (stage === "venues" && venues.length === 0) {
      onUpdate({
        importVenues: false,
        selectedVenueExternalIds: [],
      });
      toast.info("В Quick Resto не найдено заведений, пропускаем шаг");

      if (importRoles) {
        setStage("roles");
      } else if (importEmployees) {
        setStage("employees");
      } else {
        onNext();
      }
      return;
    }

    if (stage === "venues" && selectedVenueExternalIds.length === 0) {
      toast.error("Выберите минимум одно заведение");
      return;
    }
    if (stage === "roles" && roles.length > 0 && selectedRoleExternalIds.length === 0) {
      toast.error("Выберите минимум одну должность");
      return;
    }
    if (stage === "employees" && employees.length > 0 && selectedEmployeeExternalIds.length === 0) {
      toast.error("Выберите минимум одного сотрудника");
      return;
    }

    const index = flow.indexOf(stage);
    const isLast = index === flow.length - 1;
    if (isLast) {
      onNext();
      return;
    }

    setStage(flow[index + 1]);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <ListChecks className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{stepLabel}</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">{stageTitle}</h1>
        <p className="text-sm text-gray-500">{stageHint}</p>
      </div>

      <div className="px-8 py-6">
        {!loading && loadError ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <p>{loadError}</p>
            <button
              type="button"
              className="mt-2 underline underline-offset-2"
              onClick={() => setReloadToken((v) => v + 1)}
            >
              Повторить загрузку
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Загружаем...
          </div>
        ) : null}

        {!loading && stage === "entities" ? (
          <div className="space-y-3">
            <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
              <Checkbox checked={importVenues} onCheckedChange={(v) => onUpdate({ importVenues: Boolean(v) })} />
              <span className="text-sm text-gray-700">Заведения</span>
            </label>

            <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
              <Checkbox
                checked={importRoles}
                onCheckedChange={(v) => onUpdate({ importRoles: Boolean(v) })}
              />
              <span className="text-sm text-gray-700">Должности</span>
            </label>

            <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
              <Checkbox
                checked={importEmployees}
                onCheckedChange={(v) => onUpdate({ importEmployees: Boolean(v) })}
              />
              <span className="text-sm text-gray-700">Сотрудники</span>
            </label>
          </div>
        ) : null}

        {!loading && stage === "venues" ? (
          <div className="space-y-3">
            {venues.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500">
                В Quick Resto не найдено заведений для импорта. Нажмите «Далее», чтобы продолжить без них.
              </div>
            ) : null}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Выбрано: {selectedVenueExternalIds.length} из {venues.length}</span>
              <div className="flex items-center gap-3">
                <button type="button" className="hover:text-gray-700" onClick={() => setAll("selectedVenueExternalIds", venues.map((v) => v.id))}>Выбрать все</button>
                <button type="button" className="hover:text-gray-700" onClick={() => setAll("selectedVenueExternalIds", [])}>Очистить</button>
              </div>
            </div>

            <div className="max-h-72 overflow-auto space-y-2 pr-1">
              {venues.map((venue) => (
                <label key={venue.id} className="flex items-start gap-3 rounded-xl border border-gray-200 px-3 py-2">
                  <Checkbox
                    checked={selectedVenueExternalIds.includes(venue.id)}
                    onCheckedChange={(v) => toggle(selectedVenueExternalIds, venue.id, Boolean(v), "selectedVenueExternalIds")}
                  />
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">{venue.name}</strong>
                    {venue.address ? <span className="block text-gray-500">{venue.address}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && stage === "roles" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Выбрано: {selectedRoleExternalIds.length} из {roles.length}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="hover:text-gray-700"
                  onClick={() => setAll("selectedRoleExternalIds", roles.filter((r) => r.systemRole === "Custom").map((r) => r.id))}
                >
                  Выбрать Custom
                </button>
                <button type="button" className="hover:text-gray-700" onClick={() => setAll("selectedRoleExternalIds", [])}>Очистить</button>
              </div>
            </div>

            <div className="max-h-72 overflow-auto space-y-2 pr-1">
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
                  <Checkbox
                    checked={selectedRoleExternalIds.includes(role.id)}
                    onCheckedChange={(v) => toggle(selectedRoleExternalIds, role.id, Boolean(v), "selectedRoleExternalIds")}
                  />
                  <span className="text-sm text-gray-700 flex-1">{role.title}</span>
                  {role.systemRole ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{role.systemRole}</span>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && stage === "employees" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Выбрано: {selectedEmployeeExternalIds.length} из {employees.length}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="hover:text-gray-700"
                  onClick={() => setAll("selectedEmployeeExternalIds", employees.filter((e) => !e.blocked).map((e) => e.id))}
                >
                  Выбрать активных
                </button>
                <button type="button" className="hover:text-gray-700" onClick={() => setAll("selectedEmployeeExternalIds", [])}>Очистить</button>
              </div>
            </div>

            <div className="max-h-72 overflow-auto space-y-2 pr-1">
              {employees.map((employee) => (
                <label key={employee.id} className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
                  <Checkbox
                    checked={selectedEmployeeExternalIds.includes(employee.id)}
                    onCheckedChange={(v) => toggle(selectedEmployeeExternalIds, employee.id, Boolean(v), "selectedEmployeeExternalIds")}
                  />
                  <span className="text-sm text-gray-700 flex-1">{employee.fullName}</span>
                  {employee.blocked ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-500">blocked</span>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="px-8 pb-8 flex gap-3">
        <button
          type="button"
          onClick={goBackStage}
          className="h-12 flex-1 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
        >
          Назад
        </button>
        <button
          type="button"
          onClick={goNextStage}
          className="h-12 flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
        >
          {stage === "entities" ? "Продолжить" : flow.indexOf(stage) === flow.length - 1 ? "К импорту" : "Далее"}
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

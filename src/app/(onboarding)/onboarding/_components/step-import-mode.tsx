"use client";

import { Database, PencilLine } from "lucide-react";

interface Props {
  onSelect: (mode: "manual" | "quickresto") => void;
  stepLabel?: string;
}

export function StepImportMode({ onSelect, stepLabel = "Шаг 3" }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <Database className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
            {stepLabel}
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Как начнем настройку?</h1>
        <p className="text-sm text-gray-500">Вы можете импортировать данные из Quick Resto или заполнить всё вручную.</p>
      </div>

      <div className="px-8 py-6 space-y-4">
        <button
          type="button"
          onClick={() => onSelect("quickresto")}
          className="w-full text-left rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50/40 transition-colors p-4"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
              <Database className="w-4 h-4 text-blue-700" />
            </div>
            <p className="font-medium text-gray-900">Импорт из Quick Resto</p>
          </div>
          <p className="text-sm text-gray-600">Подключим аккаунт, выберем сущности и загрузим данные автоматически.</p>
        </button>

        <button
          type="button"
          onClick={() => onSelect("manual")}
          className="w-full text-left rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50/40 transition-colors p-4"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
              <PencilLine className="w-4 h-4 text-blue-700" />
            </div>
            <p className="font-medium text-gray-900">Заполнить вручную</p>
          </div>
          <p className="text-sm text-gray-600">Создадим аккаунт, заведение и сотрудников шаг за шагом здесь.</p>
        </button>
      </div>
    </div>
  );
}

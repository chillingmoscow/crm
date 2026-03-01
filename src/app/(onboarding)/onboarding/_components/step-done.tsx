"use client";

import { useRouter } from "next/navigation";
import { CheckCircle, Users, Calendar, BarChart3, Settings } from "lucide-react";

const FEATURES = [
  { icon: Users,    label: "Управление персоналом" },
  { icon: Calendar, label: "Бронирования и смены" },
  { icon: BarChart3, label: "Аналитика и отчёты" },
  { icon: Settings,  label: "Настройки заведения" },
];

export function StepDone() {
  const router = useRouter();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">

      {/* Header — centred success state */}
      <div className="px-8 pt-10 pb-6 border-b border-gray-50 text-center">
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
            <CheckCircle className="w-9 h-9 text-green-600" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Всё готово!</h1>
        <p className="text-sm text-gray-500 max-w-[320px] mx-auto">
          Заведение создано и настроено. Теперь у вас есть доступ ко всем инструментам платформы.
        </p>
      </div>

      {/* Body */}
      <div className="px-8 py-6">
        <div className="grid grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-gray-50 text-sm text-gray-600"
            >
              <Icon className="w-4 h-4 text-gray-400 shrink-0" />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-8 pb-8">
        <button
          onClick={() => router.push("/dashboard")}
          className="h-12 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm
                     font-medium transition-colors duration-150 flex items-center justify-center"
        >
          Перейти в панель управления
        </button>
      </div>
    </div>
  );
}

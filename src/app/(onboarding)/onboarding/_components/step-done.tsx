"use client";

import { useRouter } from "next/navigation";
import { CheckCircle, Settings, Users, BarChart3, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES = [
  { icon: Users,    label: "Управление персоналом" },
  { icon: Calendar, label: "Бронирования и смены" },
  { icon: BarChart3, label: "Аналитика и отчёты" },
  { icon: Settings,  label: "Настройки заведения" },
];

export function StepDone() {
  const router = useRouter();

  return (
    <Card>
      <CardHeader className="text-center space-y-3">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle className="w-9 h-9 text-green-600" />
          </div>
        </div>
        <CardTitle className="text-2xl">Всё готово!</CardTitle>
        <CardDescription>
          Заведение создано и настроено. Теперь у вас есть доступ ко всем инструментам платформы.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground"
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </div>
          ))}
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={() => router.push("/dashboard")}
        >
          Перейти в панель управления
        </Button>
      </CardContent>
    </Card>
  );
}

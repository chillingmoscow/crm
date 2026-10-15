"use client";
import { useRef, useState } from "react";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { SalesConfiguration } from "@/lib/sales/types";
import { saveSalesSettings } from "../actions";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
export function SettingsDrawer({
  data,
  open,
  onClose,
  onSaved,
}: {
  data: SalesConfiguration;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = data.settings;
  const [enabled, setEnabled] = useState(s?.enabled ?? false);
  const [timezone, setTimezone] = useState(s?.timezone ?? data.timezone);
  const [hour, setHour] = useState(String(s?.day_start_hour ?? 9));
  const [staff, setStaff] = useState(String(s?.staff_group_id ?? 8));
  const [hookah, setHookah] = useState(String(s?.hookah_report_id ?? 216));
  const [tips, setTips] = useState(
    JSON.stringify(
      s?.tip_products ?? {
        "679": -1,
        "680": -5,
        "681": -10,
        "682": -50,
        "683": -100,
        "3185": -500,
        "3186": -1000,
      },
      null,
      2,
    ),
  );
  const [deposits, setDeposits] = useState(
    JSON.stringify(
      s?.deposit_products ?? {
        "1649": -1,
        "1648": -5,
        "1164": -10,
        "1162": -50,
        "1019": -100,
        "751": -1000,
        "2766": -5000,
      },
      null,
      2,
    ),
  );
  const [parking, setParking] = useState(
    (s?.parking_product_ids ?? [1503]).join(", "),
  );
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = JSON.stringify({
    enabled,
    timezone,
    hour,
    staff,
    hookah,
    tips,
    deposits,
    parking,
  });
  const original = useRef(current);
  const [discard, setDiscard] = useState(false);
  const close = () => {
    if (busy) return;
    if (current !== original.current) setDiscard(true);
    else onClose();
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!hour.trim() || !staff.trim() || !hookah.trim())
        throw new Error(
          "Заполните начало дня, группу Staff и отчёт по кальянам",
        );
      await saveSalesSettings(
        {
          enabled,
          timezone,
          day_start_hour: Number(hour),
          staff_group_id: Number(staff),
          hookah_report_id: Number(hookah),
          quickresto_venue_id: null,
          tip_products: JSON.parse(tips),
          deposit_products: JSON.parse(deposits),
          parking_product_ids: parking.trim()
            ? parking.split(",").map((v) => Number(v.trim()))
            : [],
        },
        data.venueId,
      );
      toast.success("Настройки сохранены");
      onSaved();
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "Проверьте формат номиналов: объект с ID позиции и суммой"
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(v) => {
          if (!v) close();
        }}
        title="Расчёт смен"
        description={data.venueName}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={close}>
              Отмена
            </Button>
            <Button
              disabled={busy || data.pending > 0}
              onClick={() => void save()}
            >
              Сохранить
            </Button>
          </>
        }
      >
        {data.pending > 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            Идёт пересчёт истории. Новые правила можно сохранить после его
            завершения.
          </p>
        )}
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="sales-enabled">Автоматическое обновление</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Каждые 15 минут. Завершённый день проверяем после 09:45.
            </p>
          </div>
          <Switch
            id="sales-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!data.connected}
          />
        </div>
        {!data.connected && (
          <p className="text-sm text-muted-foreground">
            Сначала подключите Quick Resto в разделе интеграций.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="sales-zone">Часовой пояс заведения</Label>
          <Input
            id="sales-zone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sales-start">Начало рабочего дня, час</Label>
          <Input
            id="sales-start"
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(e) => setHour(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Смена относится к дате начала рабочего дня.
          </p>
        </div>
        <Button variant="outline" onClick={() => setAdvanced(!advanced)}>
          {advanced
            ? "Скрыть параметры расчёта"
            : "Параметры расчёта Quick Resto"}
        </Button>
        {advanced && (
          <div className="space-y-5">
            <p className="text-xs text-muted-foreground">
              Параметры определяют расчёт из Quick Resto. После изменения правил
              старые смены автоматически не пересчитываются.
            </p>
            {[
              ["sales-staff", "ID группы Staff", staff, setStaff],
              ["sales-hookah", "ID отчёта по кальянам", hookah, setHookah],
            ].map(([id, label, value, setter]) => (
              <div key={id as string} className="space-y-2">
                <Label htmlFor={id as string}>{label as string}</Label>
                <Input
                  id={id as string}
                  inputMode="numeric"
                  value={value as string}
                  onChange={(e) =>
                    (setter as (v: string) => void)(e.target.value)
                  }
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Разделение нескольких заведений Quick Resto требует проверки
              привязки терминалов и отчёта. До проверки оставьте подключение для
              одного заведения.
            </p>
            <div className="space-y-2">
              <Label htmlFor="sales-parking">
                ID позиций парковки, через запятую
              </Label>
              <Input
                id="sales-parking"
                value={parking}
                onChange={(e) => setParking(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sales-tips">
                Номиналы чаевых: ID → множитель
              </Label>
              <Textarea
                id="sales-tips"
                rows={8}
                value={tips}
                onChange={(e) => setTips(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sales-deposits">
                Номиналы пополнений депозитов
              </Label>
              <Textarea
                id="sales-deposits"
                rows={8}
                value={deposits}
                onChange={(e) => setDeposits(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </EditDrawer>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить изменения настроек?</AlertDialogTitle>
            <AlertDialogDescription>
              Несохранённые изменения будут потеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Продолжить редактирование</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>
              Отменить изменения
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

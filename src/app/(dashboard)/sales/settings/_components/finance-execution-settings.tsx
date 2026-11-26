"use client";
import { unwrapAction } from "@/lib/actions/result";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ProfileSection } from "@/components/shared/profile-section";
import { formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import {
  loadFinanceExecutionConfiguration,
  saveFinanceExecutionRules,
  type FinanceExecutionConfiguration,
} from "@/app/(dashboard)/sales/shifts/native-finance-actions";
import { RuleHistory } from "@/app/(dashboard)/org/venues/[venueId]/_components/rule-history";

function Form({
  open,
  data,
  onClose,
  onSaved,
}: {
  /** Панель держат смонтированной, пока она уезжает: закрывают через `open`. */
  open: boolean;
  data: FinanceExecutionConfiguration;
  onClose: () => void;
  onSaved: (v: FinanceExecutionConfiguration) => void;
}) {
  const previous = data.versions[0];
  const [enabled, setEnabled] = useState(previous?.enabled ?? false),
    [from, setFrom] = useState(previous?.from_date ?? data.suggestedFrom),
    [settlement, setSettlement] = useState(previous?.settlement ?? true),
    [movements, setMovements] = useState(previous?.movements ?? true),
    [stopped, setStopped] = useState(previous?.legacy_stopped ?? false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = unwrapAction(await saveFinanceExecutionRules({
        venueId: data.venueId,
        version: previous?.version ?? 0,
        enabled,
        from: enabled ? from : (previous?.from_date ?? null),
        settlement,
        movements,
        legacyStopped: stopped,
        reason,
      }));
      if (next) {
        onSaved(next);
        toast.success("Режим проведения сохранён");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить режим");
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditDrawer
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title="Финансовые операции"
      description="Поступления и движения денег по сменам"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={
              busy ||
              !reason.trim() ||
              (enabled && (!from || !stopped || (!settlement && !movements)))
            }
            onClick={() => void save()}
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="finance-auto">Автоматическое проведение</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Создавать и корректировать связанные операции в финансах.
            </p>
          </div>
          <Switch
            id="finance-auto"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>
        <DrawerSection title="Что проводить">
          <label className="flex items-start gap-3">
            <Checkbox
              checked={settlement}
              onCheckedChange={(v) => setSettlement(v === true)}
            />
            <span className="text-sm">Выручка и личное потребление</span>
          </label>
          <label className="flex items-start gap-3">
            <Checkbox
              checked={movements}
              onCheckedChange={(v) => setMovements(v === true)}
            />
            <span className="text-sm">
              Инкассации, внесения, такси и выдача чаевых
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Изменённые чеки корректируют связанные операции с историей. Ручные
            правки сохраняются и требуют проверки.
          </p>
        </DrawerSection>
        {enabled && (
          <DrawerSection title="Запуск">
            <Field id="finance-from" label="Начиная с рабочего дня" required>
              {(control) => (
                <DatePicker
                  id={control.id}
                  value={from}
                  onChange={setFrom}
                  clearable={false}
                />
              )}
            </Field>
            <label className="flex items-start gap-3">
              <Checkbox
                checked={stopped}
                onCheckedChange={(v) => setStopped(v === true)}
              />
              <span className="text-sm">
                Подтверждаю: прежняя автоматика этих денежных операций
                остановлена, остатки и связи проверены.
              </span>
            </label>
          </DrawerSection>
        )}
        <Field id="finance-mode-reason" label="Основание изменения" required>
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="Что изменили и почему"
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </fieldset>
    </EditDrawer>
  );
}

/**
 * Режим проведения финансовых операций. Загрузчик возвращает `null`, если у
 * пользователя нет права на эти правила: тогда секции нет.
 */
export function FinanceExecutionSettingsSection({
  venueId,
}: {
  venueId: string;
}) {
  const [data, setData] = useState<FinanceExecutionConfiguration | null>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  // Форму держим смонтированной, пока панель уезжает (docs/motion.md);
  // каждое открытие — новый ключ, форма начинается с сохранённых данных.
  const [session, setSession] = useState(0);
  const openForm = () => {
    setSession((n) => n + 1);
    setOpen(true);
  };
  useEffect(() => {
    let live = true;
    setData(null);
    setOpen(false);
    setError(null);
    setLoading(true);
    loadFinanceExecutionConfiguration(venueId)
      .then(unwrapAction)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [venueId]);
  // Пока данные грузятся, секция стоит на месте заглушкой: страница не прыгает.
  // Без доступа (пустой ответ) секции нет.
  if (loading || (data && data.venueId !== venueId))
    return (
      <ProfileSection title="Проведение финансовых операций">
        <div role="status" aria-label="Загружаем проведение операций" aria-busy className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </ProfileSection>
    );
  if (!data && !error) return null;
  const current = data?.versions[0];
  return (
    <ProfileSection
      title="Проведение финансовых операций"
      description={
        current?.enabled
          ? `Автоматически с ${formatDayMonth(current.from_date) ?? "—"}`
          : "Режим сверки: денежные операции остаются в прежней системе."
      }
      actions={
        data ? (
          <Button variant="outline" size="sm" onClick={() => openForm()}>
            <Settings2 />
            Настроить
          </Button>
        ) : null
      }
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!!data?.versions.length && (
        <RuleHistory count={data.versions.length}>
          <ol className="divide-y text-sm">
            {data.versions.map((v) => (
              <li key={v.id} className="space-y-1 py-3">
                <p>
                  Версия {v.version} · {v.actor_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDayMonthTime(v.created_at)} ·{" "}
                  {v.enabled
                    ? `проведение с ${formatDayMonth(v.from_date) ?? "—"}`
                    : "режим сверки"}
                </p>
                <p className="text-muted-foreground">{v.reason}</p>
              </li>
            ))}
          </ol>
        </RuleHistory>
      )}
      {data && (
        <Form
          key={`${venueId}:${session}`}
          open={open}
          data={data}
          onClose={() => setOpen(false)}
          onSaved={(v) => {
            setData(v);
            setOpen(false);
          }}
        />
      )}
    </ProfileSection>
  );
}

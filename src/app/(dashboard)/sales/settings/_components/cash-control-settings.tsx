"use client";
import { unwrapAction, type ActionResult } from "@/lib/actions/result";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AmountInput } from "@/components/finance/amount-input";
import { ProfileSection } from "@/components/shared/profile-section";
import { formatRub } from "@/components/shared/money";
import { formatDayMonthTime } from "@/lib/format/date";
import {
  initialCashControlRules,
  type CashControlRules,
} from "@/lib/sales/cash-control";
import {
  loadCashConfiguration,
  saveCashConfiguration,
  type CashConfiguration,
} from "@/app/(dashboard)/sales/shifts/cash-control-actions";
import { RuleHistory } from "@/app/(dashboard)/org/venues/[venueId]/_components/rule-history";

/** Сообщение загрузчика, когда у пользователя нет права на контроль кассы. */
const NO_ACCESS = "Нет доступа к контролю кассы";

const rub = (cents: number) => formatRub(cents / 100, { fraction: "auto" });

function Form({
  open,
  data,
  onClose,
  onSaved,
}: {
  /** Панель держат смонтированной, пока она уезжает: закрывают через `open`. */
  open: boolean;
  data: CashConfiguration;
  onClose: () => void;
  onSaved: (d: CashConfiguration) => void;
}) {
  const previous = data.versions[0],
    initial = previous?.config ?? initialCashControlRules;
  const [rules, setRules] = useState<CashControlRules>(initial),
    [threshold, setThreshold] = useState<number | null>(
      initial.thresholdCents / 100,
    ),
    [interval, setIntervalMinutes] = useState(String(initial.intervalMinutes)),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [invalid, setInvalid] = useState<{
      threshold?: string;
      interval?: string;
    }>({});
  const submit = async () => {
    const problems = {
      threshold:
        threshold === null ||
        Math.abs(threshold * 100 - Math.round(threshold * 100)) > 0.000001
          ? "Укажите сумму, не больше двух знаков после запятой"
          : undefined,
      interval:
        rules.autoRead && !/^\d+$/.test(interval.trim())
          ? "Укажите целое число минут"
          : undefined,
    };
    setInvalid(problems);
    if (problems.threshold || problems.interval) return;
    setBusy(true);
    setError(null);
    try {
      const saved = unwrapAction(await saveCashConfiguration({
        venueId: data.venueId,
        version: previous?.version ?? 0,
        config: {
          ...rules,
          thresholdCents: Math.round((threshold ?? 0) * 100),
          intervalMinutes: /^\d+$/.test(interval.trim())
            ? Number(interval)
            : initial.intervalMinutes,
        },
        reason,
      }));
      onSaved(saved);
      toast.success("Правила контроля кассы сохранены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правила");
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
      title="Контроль кассы"
      description="Открытие и закрытие кассовых смен"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={busy || !reason.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <fieldset
        disabled={busy || !data.canManage}
        className="flex min-w-0 flex-col gap-5"
      >
        <DrawerSection title="Расхождения">
          <Field
            id="cash-threshold"
            label="Порог расхождения"
            required
            hint="0: показывать любое ненулевое расхождение. Недостача и излишек сравниваются с одним порогом."
            error={invalid.threshold}
          >
            {(control) => (
              <AmountInput
                id={control.id}
                value={threshold}
                onChange={setThreshold}
              />
            )}
          </Field>
          {(
            [
              ["opening", "Проверять открытие"],
              ["closing", "Проверять закрытие"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`cash-${key}`}>{label}</Label>
              <Switch
                id={`cash-${key}`}
                checked={rules[key]}
                onCheckedChange={(v) => setRules((r) => ({ ...r, [key]: v }))}
              />
            </div>
          ))}
        </DrawerSection>
        <DrawerSection
          title="Уведомления в приложении"
          description="Для новых открытий и закрытий кассы."
          actions={
            <Switch
              id="cash-notify"
              aria-label="Уведомления в приложении"
              checked={rules.notifyFinance}
              onCheckedChange={(v) =>
                setRules((r) => ({ ...r, notifyFinance: v }))
              }
            />
          }
        >
          {rules.notifyFinance && (
            <Field id="cash-audience" label="Получатели" required>
              {(control) => (
                <OptionSelect
                  {...control}
                  value={rules.notificationAudience}
                  onValueChange={(v) =>
                    setRules((r) => ({
                      ...r,
                      notificationAudience:
                        v as CashControlRules["notificationAudience"],
                    }))
                  }
                  options={[
                    {
                      value: "owner_finance",
                      label: "Владелец и пользователи с доступом к финансам",
                    },
                    { value: "owner", label: "Только владелец" },
                  ]}
                />
              )}
            </Field>
          )}
        </DrawerSection>
        <DrawerSection
          title="Автоматическая проверка"
          description="Текущий и предыдущий рабочий день."
          actions={
            <Switch
              id="cash-auto"
              aria-label="Автоматическая проверка"
              checked={rules.autoRead}
              onCheckedChange={(v) => setRules((r) => ({ ...r, autoRead: v }))}
            />
          }
        >
          {rules.autoRead && (
            <Field
              id="cash-interval"
              label="Интервал проверки, минут"
              required
              hint="От 15 минут до суток."
              error={invalid.interval}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  value={interval}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                />
              )}
            </Field>
          )}
        </DrawerSection>
        <Field id="cash-reason" label="Основание изменения" required>
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

const audience = (c: CashControlRules) =>
  c.notifyFinance
    ? c.notificationAudience === "owner"
      ? "владельцу"
      : "владельцу и финансам"
    : "выкл.";

export function CashControlSettingsSection({
  venueId,
  initial,
}: {
  venueId: string;
  /** Настройки, загруженные сервером: секция сразу рисуется заполненной. */
  initial?: ActionResult<CashConfiguration>;
}) {
  const [servedVenueId] = useState(venueId);
  const [data, setData] = useState<CashConfiguration | null>(initial?.ok ? initial.data : null),
    [error, setError] = useState<string | null>(initial && !initial.ok ? initial.error : null),
    [open, setOpen] = useState(false);
  // Форму держим смонтированной, пока панель уезжает (docs/motion.md);
  // каждое открытие — новый ключ, форма начинается с сохранённых данных.
  const [session, setSession] = useState(0);
  const openForm = () => {
    setSession((n) => n + 1);
    setOpen(true);
  };
  useEffect(() => {
    // Данные, присланные сервером для этого заведения, уже на экране —
    // запрос не нужен (секция не меняет высоту после загрузки скриптов).
    if (initial && venueId === servedVenueId) return;
    let live = true;
    loadCashConfiguration(venueId)
      .then(unwrapAction)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [venueId, initial, servedVenueId]);
  // Нет права — секции нет (как у «Проведения финансовых операций»).
  if (error === NO_ACCESS) return null;
  const current = data?.versions[0];
  return (
    <ProfileSection
      title="Контроль кассы"
      description={
        current
          ? `Порог ${rub(current.config.thresholdCents)} · ${current.config.autoRead ? `каждые ${current.config.intervalMinutes} мин` : "ручная проверка"}`
          : "Расхождения при открытии и закрытии смен"
      }
      locked={
        data && !data.canManage
          ? { tone: "locked", message: "Правила контроля кассы изменяет владелец" }
          : undefined
      }
      actions={
        data?.canManage ? (
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
      {data && current && (
        <RuleHistory count={data.versions.length}>
          <ol className="divide-y text-sm">
            {data.versions.map((v) => (
              <li key={v.id} className="space-y-1 py-3">
                <p>
                  Версия {v.version} · {v.actor_name}
                </p>
                <p className="text-muted-foreground">
                  {formatDayMonthTime(v.created_at)} · {v.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  Порог {rub(v.config.thresholdCents)} · открытие{" "}
                  {v.config.opening ? "вкл." : "выкл."} · закрытие{" "}
                  {v.config.closing ? "вкл." : "выкл."} ·{" "}
                  {v.config.autoRead
                    ? `каждые ${v.config.intervalMinutes} мин`
                    : "ручная проверка"}{" "}
                  · уведомления {audience(v.config)}
                </p>
              </li>
            ))}
          </ol>
        </RuleHistory>
      )}
      {data && (
        <Form
          key={session}
          open={open}
          data={data}
          onClose={() => setOpen(false)}
          onSaved={(d) => {
            setData(d);
            setOpen(false);
          }}
        />
      )}
    </ProfileSection>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ProfileSection } from "@/components/shared/profile-section";
import { formatDayMonthTime } from "@/lib/format/date";
import {
  loadSettlementConfiguration,
  saveSettlementConfiguration,
  type SettlementConfiguration,
} from "@/app/(dashboard)/sales/shifts/settlement-actions";
import type { SettlementSettings } from "@/lib/sales/settlement";
import { RuleHistory } from "@/app/(dashboard)/org/venues/[venueId]/_components/rule-history";

/** Сообщение загрузчика, когда сверка пользователю недоступна. */
const NO_ACCESS = "Сверка доступна владельцу в выбранном заведении";

type Choice = { id: string; name: string };
/** Выпадающий список поля формы: подпись, обязательность и связь — через `Field`. */
function Picker({
  id,
  label,
  value,
  onChange,
  items,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: Choice[];
  placeholder: string;
}) {
  return (
    <Field id={id} label={label} required>
      {(control) => (
        <OptionSelect
          {...control}
          value={value}
          onValueChange={onChange}
          placeholder={placeholder}
          options={items.map((x) => ({ value: x.id, label: x.name }))}
        />
      )}
    </Field>
  );
}
function Form({
  data,
  onClose,
  onSaved,
}: {
  data: SettlementConfiguration;
  onClose: () => void;
  onSaved: (v: SettlementConfiguration) => void;
}) {
  const current = data.versions[0];
  const [config, setConfig] = useState<SettlementSettings>(
    current?.config ?? {
      venueId: data.venueId,
      timezone: data.timezone,
      dayStartHour: data.dayStartHour,
      revenueCategoryId: "",
      methods: data.methods.map((m) => ({
        paymentTypeId: m.id,
        bankAccountId: null,
        excluded: null,
        feePercent: 0,
        feeAccounting: "net",
      })),
      personal: null,
    },
  );
  const [auto, setAuto] = useState(current?.auto_read ?? false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [newId, setNewId] = useState(""),
    [newIdError, setNewIdError] = useState<string | null>(null);
  const [fees, setFees] = useState<Record<number, string>>(
    Object.fromEntries(
      config.methods.map((m) => [m.paymentTypeId, String(m.feePercent)]),
    ),
  );
  const [personal, setPersonal] = useState({
    payerId: String(config.personal?.payerId ?? ""),
    bankAccountId: config.personal?.bankAccountId ?? "",
    incomeCategoryId: config.personal?.incomeCategoryId ?? "",
    expenseCategoryId: config.personal?.expenseCategoryId ?? "",
  });
  const setMethod = (
    id: number,
    patch: Partial<SettlementSettings["methods"][number]>,
  ) =>
    setConfig((c) => ({
      ...c,
      methods: c.methods.map((m) =>
        m.paymentTypeId === id ? { ...m, ...patch } : m,
      ),
    }));
  const [personalEnabled, setPersonalEnabled] = useState(!!config.personal);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const methods = config.methods.map((m) => {
        const text = fees[m.paymentTypeId] ?? "0";
        if (!/^\d+(?:[.,]\d{1,4})?$/.test(text.trim()))
          throw new Error("Проверьте процент комиссии");
        return {
          ...m,
          feePercent: m.excluded ? 0 : Number(text.replace(",", ".")),
        };
      });
      if (personalEnabled && !/^\d+$/.test(personal.payerId))
        throw new Error("Укажите номер плательщика Quick Resto");
      const next = {
        ...config,
        timezone: data.timezone,
        dayStartHour: data.dayStartHour,
        methods,
        personal: personalEnabled
          ? { ...personal, payerId: Number(personal.payerId) }
          : null,
      };
      const saved = await saveSettlementConfiguration({
        venueId: data.venueId,
        version: current?.version ?? 0,
        config: next,
        autoRead: auto,
        reason,
      });
      onSaved(saved);
      toast.success("Правила поступлений сохранены");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Не удалось сохранить правила";
      setError(
        message.includes('"code"')
          ? "Выберите статьи и счета для всех способов оплаты"
          : message,
      );
    } finally {
      setBusy(false);
    }
  };
  const categories = (type: string) =>
    data.categories.filter((c) => c.type === type);
  return (
    <EditDrawer
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title="Поступления из Quick Resto"
      description="Счета, комиссии и личное потребление"
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
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
        <p className="rounded-lg bg-brand/5 p-3 text-sm text-muted-foreground">
          Пока работает сверка: денежные операции продолжает создавать прежняя автоматизация.
        </p>
        <Picker
          id="settlement-category"
          label="Статья выручки"
          value={config.revenueCategoryId}
          onChange={(v) => setConfig((c) => ({ ...c, revenueCategoryId: v }))}
          items={categories("income")}
          placeholder="Выберите статью"
        />
        <DrawerSection title="Способы оплаты">
          {config.methods.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Прочитайте завершённый день в продажах, чтобы получить список
              способов оплаты
            </p>
          )}
          {config.methods.length > 0 && (
            <div className="divide-y">
              {config.methods.map((m) => (
                <div
                  key={m.paymentTypeId}
                  className="space-y-3 py-4 first:pt-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="min-w-0 text-sm font-medium">
                      {data.methods.find((x) => x.id === m.paymentTypeId)?.title ??
                        `Способ №${m.paymentTypeId}`}
                    </h4>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Убрать способ №${m.paymentTypeId}`}
                      data-tip="Убрать способ оплаты"
                      onClick={() =>
                        setConfig((c) => ({
                          ...c,
                          methods: c.methods.filter(
                            (x) => x.paymentTypeId !== m.paymentTypeId,
                          ),
                        }))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Picker
                      id={`settlement-bank-${m.paymentTypeId}`}
                      label="Куда учитывать"
                      value={m.excluded ?? m.bankAccountId ?? ""}
                      onChange={(v) =>
                        setMethod(
                          m.paymentTypeId,
                          v === "bonus" || v === "no_payment"
                            ? { excluded: v, bankAccountId: null, feePercent: 0 }
                            : { excluded: null, bankAccountId: v },
                        )
                      }
                      items={[
                        ...data.banks,
                        { id: "bonus", name: "Бонусы · без поступления" },
                        { id: "no_payment", name: "Без оплаты · без поступления" },
                      ]}
                      placeholder="Выберите счёт или исключение"
                    />
                  {!m.excluded && (
                    <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
                      <Field
                        id={`settlement-fee-${m.paymentTypeId}`}
                        label="Комиссия, %"
                        required
                      >
                        {(control) => (
                          <Input
                            {...control}
                            inputMode="decimal"
                            value={fees[m.paymentTypeId] ?? "0"}
                            onChange={(e) =>
                              setFees((f) => ({
                                ...f,
                                [m.paymentTypeId]: e.target.value,
                              }))
                            }
                          />
                        )}
                      </Field>
                      <Picker
                          id={`settlement-fee-mode-${m.paymentTypeId}`}
                          label="Учёт комиссии"
                          value={m.feeAccounting}
                          onChange={(v) =>
                            setMethod(m.paymentTypeId, {
                              feeAccounting: v as "net" | "separate",
                            })
                          }
                          items={[
                            { id: "net", name: "Уменьшает поступление" },
                            { id: "separate", name: "Отдельным расходом банка" },
                          ]}
                          placeholder="Выберите способ"
                        />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              aria-label="Номер способа оплаты Quick Resto"
              aria-invalid={newIdError ? true : undefined}
              aria-describedby={newIdError ? "settlement-new-id-error" : undefined}
              inputMode="numeric"
              placeholder="Номер способа в Quick Resto"
              value={newId}
              onChange={(e) => {
                setNewId(e.target.value);
                setNewIdError(null);
              }}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Добавить способ оплаты"
              data-tip="Добавить способ оплаты"
              onClick={() => {
                const id = Number(newId);
                if (
                  !/^[1-9]\d*$/.test(newId) ||
                  !Number.isSafeInteger(id) ||
                  config.methods.some((m) => m.paymentTypeId === id)
                ) {
                  setNewIdError("Укажите уникальный номер способа оплаты");
                  return;
                }
                setConfig((c) => ({
                  ...c,
                  methods: [
                    ...c.methods,
                    {
                      paymentTypeId: id,
                      bankAccountId: null,
                      excluded: null,
                      feePercent: 0,
                      feeAccounting: "net",
                    },
                  ],
                }));
                setNewId("");
              }}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          {newIdError && (
            <p
              id="settlement-new-id-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {newIdError}
            </p>
          )}
          </div>
        </DrawerSection>
        <DrawerSection
          title="Личное потребление"
          description="Пара прихода и расхода по себестоимости чеков."
          actions={
            <Switch
              id="settlement-personal"
              aria-label="Личное потребление"
              checked={personalEnabled}
              onCheckedChange={setPersonalEnabled}
            />
          }
        >
          {personalEnabled && (
            <>
              <Field
                id="settlement-payer"
                label="Номер плательщика Quick Resto"
                required
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="numeric"
                    value={personal.payerId}
                    onChange={(e) =>
                      setPersonal((p) => ({ ...p, payerId: e.target.value }))
                    }
                  />
                )}
              </Field>
              {(
                [
                  ["bankAccountId", "Счёт", data.banks],
                  ["incomeCategoryId", "Статья прихода", categories("income")],
                  [
                    "expenseCategoryId",
                    "Статья расхода",
                    categories("expense"),
                  ],
                ] as const
              ).map(([key, label, items]) => (
                <Picker
                  key={key}
                  id={`settlement-personal-${key}`}
                  label={label}
                  value={personal[key]}
                  onChange={(v) => setPersonal((p) => ({ ...p, [key]: v }))}
                  items={items}
                  placeholder="Выберите значение"
                />
              ))}
            </>
          )}
        </DrawerSection>
        <DrawerSection
          title="Сверять каждый день"
          description="После завершения рабочего дня."
          actions={
            <Switch
              id="settlement-auto"
              aria-label="Сверять каждый день"
              checked={auto}
              onCheckedChange={setAuto}
            />
          }
        >
          {null}
        </DrawerSection>
        <Field id="settlement-reason" label="Основание изменения" required>
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Что изменили и почему"
              maxLength={1000}
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
export function SettlementSettingsSection({ venueId }: { venueId: string }) {
  const [data, setData] = useState<SettlementConfiguration | null>(null),
    [error, setError] = useState<string | null>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    loadSettlementConfiguration(venueId)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [venueId]);
  // Нет права — секции нет (как у «Проведения финансовых операций»).
  if (error === NO_ACCESS) return null;
  const current = data?.versions[0];
  return (
    <ProfileSection
      title="Поступления и личное потребление"
      description={
        current
          ? `Версия ${current.version} · ${current.auto_read ? "ежедневная сверка" : "ручная сверка"}`
          : "Сопоставление способов оплаты со счетами"
      }
      actions={
        data ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void loadSettlementConfiguration(venueId)
                .then((d) => {
                  setData(d);
                  setOpen(true);
                })
                .catch((e) => toast.error(e.message))
            }
          >
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
              </li>
            ))}
          </ol>
        </RuleHistory>
      )}
      {open && data && (
        <Form
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

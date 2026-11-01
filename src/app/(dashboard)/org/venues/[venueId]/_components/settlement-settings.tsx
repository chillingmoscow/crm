"use client";
import { useEffect, useState } from "react";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  loadSettlementConfiguration,
  saveSettlementConfiguration,
  type SettlementConfiguration,
} from "@/app/(dashboard)/sales/shifts/settlement-actions";
import type { SettlementSettings } from "@/lib/sales/settlement";
type Choice = { id: string; name: string };
function Picker({
  id,
  value,
  onChange,
  items,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  items: Choice[];
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((x) => (
          <SelectItem key={x.id} value={x.id}>
            {x.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
    [newId, setNewId] = useState("");
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
            {busy ? "Сохраняем…" : "Сохранить правила"}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="min-w-0 space-y-7">
        <p className="rounded-lg bg-brand/5 p-3 text-sm text-muted-foreground">
          Пока работает сверка: денежные операции продолжает создавать n8n.
        </p>
        <div className="space-y-2">
          <Label htmlFor="settlement-category">Статья выручки</Label>
          <Picker
            id="settlement-category"
            value={config.revenueCategoryId}
            onChange={(v) => setConfig((c) => ({ ...c, revenueCategoryId: v }))}
            items={categories("income")}
            placeholder="Выберите статью"
          />
        </div>
        <section className="space-y-4">
          <h3 className="font-medium">Способы оплаты</h3>
          {config.methods.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Прочитайте завершённый день в продажах, чтобы получить список
              способов оплаты.
            </p>
          )}
          {config.methods.map((m) => (
            <div
              key={m.paymentTypeId}
              className="space-y-3 rounded-xl border p-4"
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
              <div className="space-y-2">
                <Label htmlFor={`settlement-bank-${m.paymentTypeId}`}>
                  Куда учитывать
                </Label>
                <Picker
                  id={`settlement-bank-${m.paymentTypeId}`}
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
              </div>
              {!m.excluded && (
                <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
                  <div className="space-y-2">
                    <Label htmlFor={`settlement-fee-${m.paymentTypeId}`}>
                      Комиссия, %
                    </Label>
                    <Input
                      id={`settlement-fee-${m.paymentTypeId}`}
                      inputMode="decimal"
                      value={fees[m.paymentTypeId] ?? "0"}
                      onChange={(e) =>
                        setFees((f) => ({
                          ...f,
                          [m.paymentTypeId]: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`settlement-fee-mode-${m.paymentTypeId}`}>
                      Учёт комиссии
                    </Label>
                    <Picker
                      id={`settlement-fee-mode-${m.paymentTypeId}`}
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
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              aria-label="Номер способа оплаты Quick Resto"
              inputMode="numeric"
              placeholder="Номер способа в Quick Resto"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Добавить способ оплаты"
              onClick={() => {
                const id = Number(newId);
                if (
                  !/^[1-9]\d*$/.test(newId) ||
                  !Number.isSafeInteger(id) ||
                  config.methods.some((m) => m.paymentTypeId === id)
                ) {
                  toast.error("Укажите уникальный номер способа оплаты");
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
        </section>
        <section className="space-y-4 border-t pt-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="settlement-personal">Личное потребление</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Пара прихода и расхода по себестоимости чеков.
              </p>
            </div>
            <Switch
              id="settlement-personal"
              checked={personalEnabled}
              onCheckedChange={setPersonalEnabled}
            />
          </div>
          {personalEnabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="settlement-payer">
                  Номер плательщика Quick Resto
                </Label>
                <Input
                  id="settlement-payer"
                  inputMode="numeric"
                  value={personal.payerId}
                  onChange={(e) =>
                    setPersonal((p) => ({ ...p, payerId: e.target.value }))
                  }
                />
              </div>
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
                <div key={key} className="space-y-2">
                  <Label htmlFor={`settlement-personal-${key}`}>{label}</Label>
                  <Picker
                    id={`settlement-personal-${key}`}
                    value={personal[key]}
                    onChange={(v) => setPersonal((p) => ({ ...p, [key]: v }))}
                    items={items}
                    placeholder="Выберите значение"
                  />
                </div>
              ))}
            </>
          )}
        </section>
        <div className="flex items-center justify-between gap-4 border-t pt-5">
          <div>
            <Label htmlFor="settlement-auto">Сверять каждый день</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              После завершения рабочего дня.
            </p>
          </div>
          <Switch
            id="settlement-auto"
            checked={auto}
            onCheckedChange={setAuto}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settlement-reason">Основание изменения</Label>
          <Textarea
            id="settlement-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Что изменили и почему"
            maxLength={1000}
          />
        </div>
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
  const current = data?.versions[0];
  return (
    <section className="space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Поступления и личное потребление</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {current
              ? `Версия ${current.version} · ${current.auto_read ? "ежедневная сверка" : "ручная сверка"}`
              : "Сопоставление способов оплаты со счетами"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!data}
          onClick={() =>
            void loadSettlementConfiguration(venueId)
              .then((d) => {
                setData(d);
                setOpen(true);
              })
              .catch((e) => toast.error(e.message))
          }
        >
          <Settings2 className="mr-2 size-4" />
          Настроить
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {current && (
        <details className="border-t pt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            История правил
          </summary>
          <ol className="mt-3 divide-y">
            {data.versions.map((v) => (
              <li key={v.id} className="space-y-1 py-3">
                <p>
                  Версия {v.version} · {v.actor_name}
                </p>
                <p className="text-muted-foreground">
                  {new Date(v.created_at).toLocaleString("ru-RU")} · {v.reason}
                </p>
              </li>
            ))}
          </ol>
        </details>
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
    </section>
  );
}

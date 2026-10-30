"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { CandidateDetail, HiringOptions } from "@/lib/candidates/types";
import {
  hireCandidate,
  createCandidateRole,
  getCandidateOptions,
} from "../actions";
import { Field, FieldSelect } from "./fields";
export function HireDrawer({
  detail,
  options: initialOptions,
  onClose,
  onSaved,
}: {
  detail: CandidateDetail;
  options: HiringOptions;
  onClose: () => void;
  onSaved: (userId?: string) => void;
}) {
  const c = detail.candidate,
    old = detail.hire?.state === "reserved" ? detail.hire.input : null;
  const [options, setOptions] = useState(initialOptions),
    [first, setFirst] = useState(
      String(old?.first_name ?? c.full_name.split(/\s+/)[0] ?? ""),
    ),
    [last, setLast] = useState(
      String(old?.last_name ?? c.full_name.split(/\s+/).slice(1).join(" ")),
    ),
    [venue, setVenue] = useState(
      String(
        old?.venue_id ??
          initialOptions.venues.find(
            (v) => v.id === initialOptions.active_venue_id && v.can_hire,
          )?.id ??
          initialOptions.venues.find((v) => v.can_hire)?.id ??
          "",
      ),
    ),
    [role, setRole] = useState(String(old?.role_id ?? "")),
    [date, setDate] = useState(
      String(
        old?.employment_date ??
          new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" }),
      ),
    ),
    [existing, setExisting] = useState(String(old?.existing_user_id ?? "")),
    [busy, start] = useTransition(),
    [showRole, setShowRole] = useState(false);
  const [roleName, setRoleName] = useState(""),
    [copyRole, setCopyRole] = useState(""),
    [qrRole, setQrRole] = useState(""),
    [salary, setSalary] = useState("0"),
    [base, setBase] = useState("0"),
    [percent, setPercent] = useState("0"),
    [basis, setBasis] = useState("none"),
    [tips, setTips] = useState(false),
    [food, setFood] = useState("0"),
    [knowledge, setKnowledge] = useState("0");
  const v = options.venues.find((v) => v.id === venue),
    roles = options.roles.filter((r) => r.venue_id === venue),
    selected = roles.find((r) => r.id === role),
    rule = selected?.rules.find((r) => r.valid_from <= date),
    locked = !!old;
  const createRole = () =>
    start(async () => {
      try {
        const rates = Object.fromEntries(
          Array.from({ length: 20 }, (_, n) => [
            String(n + 1),
            Object.fromEntries(
              Array.from({ length: 7 }, (_, day) => [
                String(day + 1),
                { base: Number(base), percent: Number(percent) },
              ]),
            ),
          ]),
        );
        const id = await createCandidateRole(venue, {
          name: roleName,
          copy_role_id: copyRole || null,
          valid_from: date.slice(0, 7) + "-01",
          monthly_amount: Number(salary),
          basis,
          tips,
          shift_pay: Number(base) > 0 || Number(percent) > 0,
          rates,
          food_amount: Number(food),
          knowledge_amount: Number(knowledge),
          quickresto_role_id: qrRole ? Number(qrRole) : null,
        });
        setOptions(await getCandidateOptions());
        setRole(id);
        setShowRole(false);
        toast.success("Должность и условия оплаты созданы");
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Не удалось создать должность",
        );
      }
    });
  const hire = () =>
    start(async () => {
      try {
        const result = await hireCandidate(
          c.id,
          old ?? {
            revision: c.revision,
            venue_id: venue,
            role_id: role,
            first_name: first,
            last_name: last,
            employment_date: date,
            existing_user_id: existing || null,
            attendance_source: "quickresto",
          },
        );
        toast.success("Кандидат принят на работу");
        onSaved(result.user_id);
        onClose();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Оформление не завершено");
        onSaved();
      }
    });
  return (
    <EditDrawer
      open
      title={
        locked
          ? "Продолжить оформление"
          : existing
            ? "Связать с сотрудником"
            : "Принять на работу"
      }
      description="Сотрудник, гость и бонусный счёт в Quick Resto, доступ к складам и код офисного замка."
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={
              busy ||
              !first.trim() ||
              !last.trim() ||
              !v?.can_hire ||
              !role ||
              (!existing && !rule) ||
              showRole
            }
            onClick={hire}
          >
            {busy
              ? "Оформляем…"
              : locked
                ? "Продолжить оформление"
                : "Принять на работу"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Имя *">
          <Input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            disabled={busy || locked}
          />
        </Field>
        <Field label="Фамилия *">
          <Input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            disabled={busy || locked}
          />
        </Field>
      </div>
      <FieldSelect
        label="Заведение *"
        value={venue}
        disabled={busy || locked}
        onChange={(id) => {
          setVenue(id);
          setRole("");
          setExisting("");
          setShowRole(false);
        }}
        options={[
          { value: "", label: "Выберите заведение" },
          ...options.venues
            .filter((v) => v.can_hire)
            .map((v) => ({ value: v.id, label: v.name })),
        ]}
      />
      <FieldSelect
        label="Должность *"
        value={role}
        disabled={busy || locked || !!existing}
        onChange={setRole}
        options={[
          { value: "", label: "Выберите должность" },
          ...roles.map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
      <Field label="Дата приёма *">
        <Input
          type="date"
          value={date}
          disabled={busy || locked}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      {selected ? (
        <div className="space-y-2 rounded-lg bg-muted/40 p-4 text-sm">
          <p className="font-medium">Условия должности</p>
          {rule ? (
            <>
              <p>
                Оклад: {Number(rule.monthly_amount).toLocaleString("ru-RU")} ₽
              </p>
              <details>
                <summary className="cursor-pointer text-brand">
                  Ставки за выход и проценты
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="text-xs">
                    <thead>
                      <tr>
                        <th className="p-1 text-left">Сотрудников</th>
                        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(
                          (day) => (
                            <th className="p-1" key={day}>
                              {day}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(rule.rates).map(([count, days]) => (
                        <tr className="border-t" key={count}>
                          <th className="p-1 text-left">{count}</th>
                          {Array.from({ length: 7 }, (_, d) => (
                            <td className="whitespace-nowrap p-1" key={d}>
                              {days[String(d + 1)]?.base ?? "—"} ₽ /{" "}
                              {days[String(d + 1)]?.percent ?? "—"}%
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <p className="text-xs text-muted-foreground">
                Условия действуют с{" "}
                {rule.valid_from.split("-").reverse().join(".")} · Смены по
                отметкам Quick Resto
              </p>
            </>
          ) : (
            <p className="text-destructive">
              На дату приёма условия оплаты не настроены. Настройте их в
              карточке должности или создайте новую.
            </p>
          )}
        </div>
      ) : null}
      {v?.can_create_role && !locked ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setShowRole((x) => !x);
            setCopyRole(role);
            setQrRole(
              selected?.quickresto_role_id
                ? String(selected.quickresto_role_id)
                : "",
            );
          }}
        >
          {" "}
          {showRole
            ? "Отмена создания должности"
            : "+ Создать должность и условия оплаты"}
        </Button>
      ) : null}
      {showRole ? (
        <section className="space-y-4 border-y py-5">
          <h3 className="text-base font-semibold">Новая должность</h3>
          <Field label="Название *">
            <Input
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              maxLength={100}
            />
          </Field>
          <FieldSelect
            label="Скопировать права из должности"
            value={copyRole}
            onChange={(id) => {
              setCopyRole(id);
              setQrRole(
                roles.find((r) => r.id === id)?.quickresto_role_id
                  ? String(roles.find((r) => r.id === id)!.quickresto_role_id)
                  : "",
              );
            }}
            options={[
              { value: "", label: "Без дополнительных прав" },
              ...roles.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <FieldSelect
            label="Должность в Quick Resto"
            value={qrRole}
            onChange={setQrRole}
            options={[
              { value: "", label: "Выберите соответствующую должность" },
              ...roles
                .filter((r) => r.quickresto_role_id)
                .filter(
                  (r, i, a) =>
                    a.findIndex(
                      (x) => x.quickresto_role_id === r.quickresto_role_id,
                    ) === i,
                )
                .map((r) => ({
                  value: String(r.quickresto_role_id),
                  label: r.name,
                })),
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Месячный оклад, ₽", salary, setSalary],
              ["За выход, ₽", base, setBase],
              ["Процент от выручки, %", percent, setPercent],
              ["Питание, ₽", food, setFood],
              ["Надбавка за знания, ₽", knowledge, setKnowledge],
            ].map(([label, value, setter]) => (
              <Field key={String(label)} label={String(label)}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={String(value)}
                  onChange={(e) =>
                    (setter as (v: string) => void)(e.target.value)
                  }
                />
              </Field>
            ))}
          </div>
          <FieldSelect
            label="База процента"
            value={basis}
            onChange={setBasis}
            options={[
              { value: "none", label: "Без процента" },
              { value: "turnover", label: "Вся выручка" },
              { value: "hookah", label: "Продажи кальянов" },
              { value: "bar", label: "Продажи бара" },
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={tips}
              onCheckedChange={(v) => setTips(v === true)}
            />
            Участвует в распределении чаевых
          </label>
          <p className="text-xs text-muted-foreground">
            Условия создаются с первого числа месяца приёма. Подробные условия и
            права можно изменить в карточке должности.
          </p>
          <Button
            disabled={busy || !roleName.trim() || !qrRole}
            onClick={createRole}
          >
            Создать должность
          </Button>
        </section>
      ) : null}
      {!locked ? (
        <FieldSelect
          label="Если сотрудник уже есть в Sheerly"
          value={existing}
          onChange={(id) => {
            setExisting(id);
            const member = options.staff.find(
              (m) => m.id === id && m.venue_id === venue,
            );
            if (member) {
              setRole(member.role_id);
              setFirst(member.name.split(/\s+/)[0]);
              setLast(member.name.split(/\s+/).slice(1).join(" "));
            }
          }}
          options={[
            { value: "", label: "Создать нового сотрудника" },
            ...options.staff
              .filter((m) => m.venue_id === venue)
              .map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
      ) : null}
      {!options.venues.some((v) => v.can_hire) ? (
        <p className="text-sm text-destructive">
          Для найма нужны права принимать кандидатов и добавлять сотрудников в
          выбранном заведении.
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          Оформление может занять до нескольких минут. При ошибке подтверждённые
          шаги сохранятся; продолжить можно в этой карточке.
        </p>
      ) : null}
    </EditDrawer>
  );
}

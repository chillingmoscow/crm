"use client";
import { candidateError } from "@/lib/candidates/errors";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Money } from "@/components/shared/money";
import type { CandidateDetail, HiringOptions } from "@/lib/candidates/types";
import {
  hireCandidate,
  createCandidateRole,
  getCandidateOptions,
} from "../actions";
import { Field, FieldSelect, dateLabel } from "./fields";
import { GENDER_OPTIONS, isGender } from "@/lib/people/gender";
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
    [gender, setGender] = useState(String(old?.gender ?? "")),
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
        toast.error(candidateError(e, "Не удалось создать должность"));
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
            ...(existing ? {} : { gender }),
            employment_date: date,
            existing_user_id: existing || null,
            attendance_source: "quickresto",
          },
        );
        toast.success("Кандидат принят на работу");
        onSaved(result.user_id);
        onClose();
      } catch (e) {
        toast.error(candidateError(e, "Оформление не завершено"));
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
      // Пока создаётся должность, подвал работает на неё: одна главная кнопка
      // на экране, «Отмена» возвращает к найму.
      footer={
        showRole ? (
          <>
            <Button variant="outline" disabled={busy} onClick={() => setShowRole(false)}>
              Отмена
            </Button>
            <Button
              disabled={busy || !roleName.trim() || !qrRole}
              onClick={createRole}
            >
              Создать должность
            </Button>
          </>
        ) : (
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
              // Продолжение найма, начатого до обязательного пола, идёт
              // с сохранённым входом — пол там может быть пустым.
              (!existing && !locked && !isGender(gender)) ||
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
        )
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Имя" required>
          <Input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            disabled={busy || locked}
          />
        </Field>
        <Field label="Фамилия" required>
          <Input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            disabled={busy || locked}
          />
        </Field>
      </div>
      {existing ? null : (
        <FieldSelect
          label="Пол"
          required
          value={gender}
          disabled={busy || locked}
          onChange={setGender}
          options={[{ value: "", label: "Выберите пол" }, ...GENDER_OPTIONS]}
        />
      )}
      <FieldSelect
        required
        label="Заведение"
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
      <div className="flex flex-col gap-1.5">
        <FieldSelect
          required
          label="Должность"
          value={role}
          disabled={busy || locked || !!existing || showRole}
          onChange={setRole}
          options={[
            { value: "", label: "Выберите должность" },
            ...roles.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
        {v?.can_create_role && !locked && !showRole ? (
          <button
            type="button"
            disabled={busy}
            className="self-start text-[13px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            onClick={() => {
              setShowRole(true);
              setCopyRole(role);
              setQrRole(
                selected?.quickresto_role_id
                  ? String(selected.quickresto_role_id)
                  : "",
              );
            }}
          >
            Создать должность и условия оплаты
          </button>
        ) : null}
      </div>
      <Field label="Дата трудоустройства" required>
        <DatePicker
          value={date}
          disabled={busy || locked}
          onChange={setDate}
        />
      </Field>
      {selected && !showRole ? (
        <DrawerSection title="Условия должности">
          {rule ? (
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Оклад: </span>
                <Money value={Number(rule.monthly_amount)} fraction="auto" />
              </p>
              <p className="text-xs text-muted-foreground">
                Действуют с {dateLabel(rule.valid_from)} · Смены по отметкам
                Quick Resto ·{" "}
                <Link
                  href={`/people/roles/${selected.id}?tab=compensation`}
                  target="_blank"
                  className="text-brand hover:underline"
                >
                  Ставки и проценты
                </Link>
              </p>
            </div>
          ) : (
            <p className="text-xs text-destructive">
              На дату трудоустройства условия оплаты не настроены. Настройте их
              в карточке должности или создайте новую.
            </p>
          )}
        </DrawerSection>
      ) : null}
      {showRole ? (
        <DrawerSection title="Новая должность">
          <Field label="Название" required>
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
            Условия создаются с первого числа месяца трудоустройства. Подробные
            условия и права можно изменить в карточке должности.
          </p>
        </DrawerSection>
      ) : null}
      {!locked && !showRole ? (
        <DrawerSection title="Сотрудник в Sheerly">
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
        </DrawerSection>
      ) : null}
      {!options.venues.some((v) => v.can_hire) ? (
        <p className="text-xs text-destructive">
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

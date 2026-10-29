"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import type { Candidate } from "@/lib/candidates/types";
import { updateCandidate } from "../actions";
import { Field } from "./fields";
const fields = [
  ["full_name", "ФИО"],
  ["phone", "Телефон"],
  ["desired_position", "Желаемая должность"],
  ["age", "Возраст"],
  ["address", "Адрес"],
  ["salary_expectation", "Ожидания по зарплате"],
  ["family_status", "Семейное положение"],
  ["drivers_license", "Водительские права"],
] as const;
const longFields = [
  ["education", "Образование"],
  ["experience", "Опыт работы"],
  ["plans", "Планы"],
] as const;
export function CandidateForm({
  candidate,
  onClose,
  onSaved,
}: {
  candidate: Candidate;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...fields, ...longFields].map(([key]) => [
        key,
        String(candidate[key] ?? ""),
      ]),
    ),
  );
  const [social, setSocial] = useState(candidate.social);
  const [busy, start] = useTransition();
  const set = (key: string, value: string) =>
    setValues((v) => ({ ...v, [key]: value }));
  const save = () =>
    start(async () => {
      try {
        const input = {
          ...values,
          age: values.age ? Number(values.age) : null,
          social,
        };
        const r = await updateCandidate(candidate.id, {
          ...input,
          revision: candidate.revision,
        });
        toast.success("Анкета сохранена");
        onSaved(r.id);
        onClose();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Не удалось сохранить анкету",
        );
      }
    });
  return (
    <EditDrawer
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title="Редактировать анкету"
      description="Контакты, опыт и пожелания кандидата"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy || !values.full_name.trim()} onClick={save}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <form
        id="candidate-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-5"
      >
        {fields.map(([key, label]) => (
          <Field key={key} label={label + (key === "full_name" ? " *" : "")}>
            <Input
              value={values[key]}
              required={key === "full_name"}
              type={key === "age" ? "number" : key === "phone" ? "tel" : "text"}
              min={key === "age" ? 14 : undefined}
              max={key === "age" ? 100 : undefined}
              maxLength={key === "full_name" ? 300 : 1000}
              onChange={(e) => set(key, e.target.value)}
            />
          </Field>
        ))}
        {["telegram", "vk", "instagram"].map((key) => (
          <Field
            key={key}
            label={
              { telegram: "Telegram", vk: "VK", instagram: "Instagram" }[key] ??
              key
            }
          >
            <Input
              value={social[key] ?? ""}
              onChange={(e) =>
                setSocial((v) => ({ ...v, [key]: e.target.value }))
              }
              maxLength={2000}
            />
          </Field>
        ))}
        {longFields.map(([key, label]) => (
          <Field key={key} label={label}>
            <Textarea
              value={values[key]}
              onChange={(e) => set(key, e.target.value)}
              rows={3}
              maxLength={12000}
            />
          </Field>
        ))}
      </form>
    </EditDrawer>
  );
}

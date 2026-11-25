"use client";

import { Mail, Phone, Plus, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { MAX_CONTACTS, telegramUrl, type CounterpartyContact } from "@/lib/finance/counterparty-contacts";

/** Контакт в форме: все поля строками, «» — пусто. */
export type ContactDraft = { name: string; role: string; phone: string; email: string; telegram: string };

export const emptyContact = (): ContactDraft => ({ name: "", role: "", phone: "", email: "", telegram: "" });

export function contactDraftFrom(contact: CounterpartyContact): ContactDraft {
  return {
    name: contact.name,
    role: contact.role ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    telegram: contact.telegram ? `@${contact.telegram}` : "",
  };
}

/** Контакты из базы (jsonb) — без доверия к форме: чужие ключи отбрасываются. */
export function contactsFromJson(value: unknown): CounterpartyContact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      role: typeof item.role === "string" ? item.role : null,
      phone: typeof item.phone === "string" ? item.phone : null,
      email: typeof item.email === "string" ? item.email : null,
      telegram: typeof item.telegram === "string" ? item.telegram : null,
    }))
    .filter((contact) => contact.name);
}

/**
 * Контакты контрагента: менеджер, бухгалтер, экспедитор. В режиме правки —
 * карточки с полями, в режиме чтения — строки со ссылками (позвонить,
 * написать, открыть чат в Telegram).
 */
export function CounterpartyContactsEditor({
  contacts,
  onChange,
  readOnly,
  error,
}: {
  contacts: ContactDraft[];
  onChange: (contacts: ContactDraft[]) => void;
  readOnly: boolean;
  error: string | null;
}) {
  if (readOnly) {
    if (contacts.length === 0) return <p className="text-sm text-muted-foreground">Контактов нет</p>;
    return (
      <ul className="divide-y rounded-lg border">
        {contacts.map((contact, index) => (
          <li key={index} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
            <span className="font-medium">
              {contact.name}
              {contact.role ? <span className="font-normal text-muted-foreground"> · {contact.role}</span> : null}
            </span>
            <ContactLinks contact={contact} />
          </li>
        ))}
      </ul>
    );
  }

  const update = (index: number, patch: Partial<ContactDraft>) =>
    onChange(contacts.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));

  return (
    <div className="flex flex-col gap-3">
      {contacts.map((contact, index) => (
        <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <Field id={`cp-contact-${index}-name`} label="Имя" required>
            {(control) => (
              <Input
                {...control}
                value={contact.name}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder="Иван Петров"
                maxLength={200}
              />
            )}
          </Field>
          <Field id={`cp-contact-${index}-role`} label="Роль">
            {(control) => (
              <Input
                {...control}
                value={contact.role}
                onChange={(event) => update(index, { role: event.target.value })}
                placeholder="Менеджер, бухгалтер, экспедитор"
                maxLength={100}
              />
            )}
          </Field>
          <Field id={`cp-contact-${index}-phone`} label="Телефон">
            {(control) => (
              <PhoneInput {...control} value={contact.phone} onChange={(value) => update(index, { phone: value })} />
            )}
          </Field>
          <Field id={`cp-contact-${index}-email`} label="Почта">
            {(control) => (
              <Input
                {...control}
                value={contact.email}
                onChange={(event) => update(index, { email: event.target.value })}
                inputMode="email"
                placeholder="info@example.ru"
                maxLength={200}
              />
            )}
          </Field>
          <Field id={`cp-contact-${index}-telegram`} label="Telegram">
            {(control) => (
              <Input
                {...control}
                value={contact.telegram}
                onChange={(event) => update(index, { telegram: event.target.value })}
                placeholder="@ник или ссылка t.me"
                maxLength={100}
              />
            )}
          </Field>
          <div className="flex items-end justify-end">
            <Button
              type="button"
              variant="ghost"
              className="gap-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onChange(contacts.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
              Убрать контакт
            </Button>
          </div>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {contacts.length < MAX_CONTACTS ? (
        <div>
          <Button type="button" variant="outline" className="gap-2" onClick={() => onChange([...contacts, emptyContact()])}>
            <Plus className="size-4" />
            Добавить контакт
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ContactLinks({ contact }: { contact: ContactDraft }) {
  const nick = contact.telegram.replace(/^@/, "");
  const links = [
    contact.phone ? { href: `tel:${contact.phone.replace(/[^\d+]/g, "")}`, icon: Phone, label: contact.phone } : null,
    contact.email ? { href: `mailto:${contact.email}`, icon: Mail, label: contact.email } : null,
    nick ? { href: telegramUrl(nick), icon: Send, label: `@${nick}`, external: true } : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);
  if (links.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          {...("external" in link ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
        >
          <link.icon className="size-3.5" aria-hidden />
          {link.label}
        </a>
      ))}
    </span>
  );
}

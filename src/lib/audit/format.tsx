import {
  Activity,
  Archive,
  ArrowLeftRight,
  ArrowRightFromLine,
  BookOpen,
  Building2,
  CircleArrowUp,
  CreditCard,
  FileEdit,
  FilePlus2,
  IdCard,
  Key,
  Mail,
  MailCheck,
  MailX,
  Pencil,
  RotateCcw,
  ShieldPlus,
  ShieldX,
  Tag,
  Trash2,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { AuditEntitySnapshot, AuditEvent } from "@/lib/audit/list";

interface AuditEventSpec {
  icon: LucideIcon;
  iconClass: string;
  /** Главная фраза события: «уволил(а) Петю Иванова. Причина: прогул».
   *  Для staff-* событий имя сотрудника (из event.entity) встраивается в
   *  фразу — без этого в общем журнале «уволил(а). Причина: …» непонятно
   *  про кого. На таб-странице самого сотрудника видеть собственное имя
   *  чуть избыточно, но это меньшее зло за читабельность. */
  buildHeadline: (event: AuditEvent) => ReactNode;
  /** Опциональный «детальный» блок под фразой — обычно diff-список
   *  изменений для profile/account_details событий. */
  buildDetails?: (event: AuditEvent) => ReactNode | null;
}

const FIELD_LABELS: Record<string, string> = {
  // staff
  phone: "телефон",
  telegram_id: "телеграм",
  birth_date: "дата рождения",
  employment_date: "дата трудоустройства",
  medical_book_number: "номер медкнижки",
  medical_book_date: "срок действия медкнижки",
  passport_photos: "фото паспорта",
  comment: "комментарий HR",
  // finance (общие)
  name: "название",
  type: "тип",
  amount: "сумма",
  currency: "валюта",
  description: "описание",
  date: "дата",
  group_id: "группа",
  is_active: "активность",
  // finance.transaction
  bank_account_id: "счёт",
  to_bank_account_id: "счёт получатель",
  to_legal_entity_id: "юрлицо получатель",
  category_id: "статья",
  counterparty_id: "контрагент",
  // bank_account
  bank_name: "банк",
  bik: "БИК",
  account_number: "номер счёта",
  card_holder: "держатель карты",
  card_number_last4: "последние 4 цифры карты",
  // counterparty
  legal_form: "правовая форма",
  inn: "ИНН",
  kpp: "КПП",
  ogrn: "ОГРН",
  contact_person: "контактное лицо",
  email: "email",
  address: "адрес",
  // category
  color: "цвет",
  icon: "иконка",
};

function formatAmount(value: unknown, currency: string = "RUB"): string {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return String(value);
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency || "RUB",
    maximumFractionDigits: 2,
  }).format(num);
}

function txTypeLabel(type: string | undefined): string {
  switch (type) {
    case "income":
      return "поступление";
    case "expense":
      return "списание";
    case "transfer":
      return "перевод";
    default:
      return type ?? "операция";
  }
}

function txNameFromEvent(event: AuditEvent): string {
  if (event.entity && event.entity.type === "transaction") {
    return `#${event.entity.public_id}`;
  }
  const publicId = event.details.public_id;
  return publicId ? `#${publicId}` : "транзакция";
}

function TxRef({ event }: { event: AuditEvent }) {
  return <strong className="font-medium">{txNameFromEvent(event)}</strong>;
}

function bankAccountName(event: AuditEvent): string {
  if (event.entity && event.entity.type === "bank_account") return event.entity.name;
  return (event.details.name as string) || "счёт";
}

function categoryName(event: AuditEvent): string {
  if (event.entity && event.entity.type === "finance_category") return event.entity.name;
  return (event.details.name as string) || "статья";
}

function counterpartyName(event: AuditEvent): string {
  if (event.entity && event.entity.type === "counterparty") return event.entity.name;
  return (event.details.name as string) || "контрагент";
}

function staffName(entity: AuditEntitySnapshot | null): string | null {
  if (!entity || entity.type !== "staff") return null;
  const name = [entity.first_name, entity.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || "Без имени";
}

function StaffName({ event }: { event: AuditEvent }) {
  const name = staffName(event.entity);
  if (!name) return <em className="text-muted-foreground">этого сотрудника</em>;
  return <strong className="font-medium">{name}</strong>;
}

/** Имя роли — приоритет live snapshot, fallback на event.details
 *  (для удалённых ролей). */
function roleNameFromEvent(event: AuditEvent): string {
  if (event.entity && event.entity.type === "role") return event.entity.name;
  const fromDetails =
    (event.details.new_name as string) ?? (event.details.name as string);
  return fromDetails || "роль";
}

function RoleName({ event }: { event: AuditEvent }) {
  return <strong className="font-medium">«{roleNameFromEvent(event)}»</strong>;
}

/** Email приглашения. Live snapshot отсутствует если приглашение уже
 *  удалено / принято — берём из payload, который тригер всегда пишет. */
function invitationEmailFromEvent(event: AuditEvent): string {
  if (event.entity && event.entity.type === "invitation") return event.entity.email;
  return (event.details.email as string) || "—";
}

function InvitationEmail({ event }: { event: AuditEvent }) {
  return <strong className="font-medium">{invitationEmailFromEvent(event)}</strong>;
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (
    field === "birth_date" ||
    field === "employment_date" ||
    field === "medical_book_date"
  ) {
    return formatDate(value);
  }
  if (field === "passport_photos") {
    if (Array.isArray(value)) {
      return value.length === 0 ? "—" : `${value.length} фото`;
    }
    return "—";
  }
  if (typeof value === "string") {
    // Длинный текст усекаем, чтобы строка не разрослась на полстраницы.
    if (value.length > 60) return value.slice(0, 60) + "…";
    return value;
  }
  return String(value);
}

interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

function changeList(details: Record<string, unknown>): FieldChange[] {
  const raw = details.changes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const obj = c as Record<string, unknown>;
      const field = typeof obj.field === "string" ? obj.field : null;
      if (!field) return null;
      return { field, old: obj.old, new: obj.new };
    })
    .filter((x): x is FieldChange => x !== null);
}

function ChangeLines({ details }: { details: Record<string, unknown> }) {
  const changes = changeList(details);
  if (changes.length === 0) return null;
  return (
    <ul className="text-[12px] text-muted-foreground flex flex-col gap-0.5">
      {changes.map((c, i) => (
        <li key={`${c.field}-${i}`} className="leading-snug">
          <span className="text-foreground">{FIELD_LABELS[c.field] ?? c.field}:</span>{" "}
          <span className="line-through">{formatFieldValue(c.field, c.old)}</span>
          {" → "}
          <span className="font-medium text-foreground">
            {formatFieldValue(c.field, c.new)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SPECS: Record<string, AuditEventSpec> = {
  // ── staff ──────────────────────────────────────────────────
  "staff.hired": {
    icon: UserPlus,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildHeadline: (e) => {
      const role = (e.details.role_name as string) || "";
      return role ? (
        <>
          принял(а) на работу <StaffName event={e} /> на должность{" "}
          <strong className="font-medium">{role}</strong>
        </>
      ) : (
        <>
          принял(а) на работу <StaffName event={e} />
        </>
      );
    },
  },
  "staff.fired": {
    icon: UserMinus,
    iconClass: "text-destructive bg-destructive/10",
    buildHeadline: (e) => {
      const reason = (e.details.reason as string) || "";
      return reason ? (
        <>
          уволил(а) <StaffName event={e} />. Причина:{" "}
          <span className="text-muted-foreground">{reason}</span>
        </>
      ) : (
        <>
          уволил(а) <StaffName event={e} />
        </>
      );
    },
  },
  "staff.restored": {
    icon: RotateCcw,
    iconClass: "text-foreground bg-muted",
    buildHeadline: (e) => {
      const prevReason = (e.details.previous_reason as string) || "";
      const prevAt = formatDate(e.details.previous_fired_at);
      return prevReason ? (
        <>
          восстановил(а) <StaffName event={e} /> (ранее уволен {prevAt}:{" "}
          <span className="text-muted-foreground">{prevReason}</span>)
        </>
      ) : (
        <>
          восстановил(а) <StaffName event={e} />
        </>
      );
    },
  },
  "staff.role_changed": {
    icon: ArrowLeftRight,
    iconClass: "text-violet-600 bg-violet-50",
    buildHeadline: (e) => {
      const oldRole = (e.details.old_role_name as string) || "—";
      const newRole = (e.details.new_role_name as string) || "—";
      return (
        <>
          перевёл(а) <StaffName event={e} />:{" "}
          <span className="line-through text-muted-foreground">{oldRole}</span>
          {" → "}
          <strong className="font-medium">{newRole}</strong>
        </>
      );
    },
  },
  "staff.profile_updated": {
    icon: IdCard,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => (
      <>
        обновил(а) контакты у <StaffName event={e} />
      </>
    ),
    buildDetails: (e) => <ChangeLines details={e.details} />,
  },
  "staff.account_details_updated": {
    icon: IdCard,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => (
      <>
        обновил(а) HR-данные у <StaffName event={e} />
      </>
    ),
    buildDetails: (e) => <ChangeLines details={e.details} />,
  },

  // ── invitation ─────────────────────────────────────────────
  "invitation.sent": {
    icon: Mail,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => {
      const role = (e.details.role_name as string) || "";
      return role ? (
        <>
          отправил(а) приглашение <InvitationEmail event={e} /> на должность{" "}
          <strong className="font-medium">{role}</strong>
        </>
      ) : (
        <>
          отправил(а) приглашение <InvitationEmail event={e} />
        </>
      );
    },
  },
  "invitation.accepted": {
    icon: MailCheck,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildHeadline: (e) => (
      <>
        принял(а) приглашение (<InvitationEmail event={e} />)
      </>
    ),
  },
  "invitation.cancelled": {
    icon: MailX,
    iconClass: "text-muted-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        отменил(а) приглашение <InvitationEmail event={e} />
      </>
    ),
  },

  // ── role ───────────────────────────────────────────────────
  "role.created": {
    icon: ShieldPlus,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildHeadline: (e) => (
      <>
        создал(а) должность <RoleName event={e} />
      </>
    ),
  },
  "role.renamed": {
    icon: FileEdit,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => {
      const oldName = (e.details.old_name as string) || "";
      const newName = (e.details.new_name as string) || "";
      return (
        <>
          переименовал(а) должность:{" "}
          <span className="text-muted-foreground line-through">«{oldName}»</span>
          {" → "}
          <strong className="font-medium">«{newName}»</strong>
        </>
      );
    },
  },
  "role.deleted": {
    icon: ShieldX,
    iconClass: "text-destructive bg-destructive/10",
    buildHeadline: (e) => (
      <>
        удалил(а) должность <RoleName event={e} />
      </>
    ),
  },
  "role.permissions_changed": {
    icon: Key,
    iconClass: "text-amber-600 bg-amber-50",
    buildHeadline: (e) => {
      const desc =
        (e.details.permission_description as string) ||
        (e.details.permission_code as string) ||
        "право";
      const action = e.details.action as string | undefined;
      let verbPhrase: ReactNode;
      if (action === "granted") {
        verbPhrase = (
          <>
            выдал(а) право <strong className="font-medium">«{desc}»</strong>
          </>
        );
      } else if (action === "revoked") {
        verbPhrase = (
          <>
            отозвал(а) право <strong className="font-medium">«{desc}»</strong>
          </>
        );
      } else {
        verbPhrase = (
          <>
            сбросил(а) право <strong className="font-medium">«{desc}»</strong> к
            дефолту
          </>
        );
      }
      return (
        <>
          {verbPhrase} у должности <RoleName event={e} />
        </>
      );
    },
  },

  // ── finance.transaction ────────────────────────────────────
  "finance.transaction.created": {
    icon: CircleArrowUp,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildHeadline: (e) => {
      const txType = e.details.type as string | undefined;
      const amount = formatAmount(e.details.amount, (e.details.currency as string) || "RUB");
      const cat = e.details.category_name as string | undefined;
      const cp = e.details.counterparty_name as string | undefined;
      return (
        <>
          добавил(а) {txTypeLabel(txType)} <TxRef event={e} /> на{" "}
          <strong className="font-medium">{amount}</strong>
          {cat && (
            <>
              {" "}— <span className="text-muted-foreground">{cat}</span>
            </>
          )}
          {cp && (
            <>
              {" "}/ <span className="text-muted-foreground">{cp}</span>
            </>
          )}
        </>
      );
    },
  },
  "finance.transaction.updated": {
    icon: Pencil,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => (
      <>
        изменил(а) транзакцию <TxRef event={e} />
      </>
    ),
    buildDetails: (e) => <ChangeLines details={e.details} />,
  },
  "finance.transaction.deleted": {
    icon: Trash2,
    iconClass: "text-destructive bg-destructive/10",
    buildHeadline: (e) => {
      const amount = formatAmount(e.details.amount);
      return (
        <>
          удалил(а) транзакцию <TxRef event={e} /> на{" "}
          <span className="text-muted-foreground">{amount}</span>
        </>
      );
    },
  },
  "finance.transaction.restored": {
    icon: RotateCcw,
    iconClass: "text-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        восстановил(а) транзакцию <TxRef event={e} />
      </>
    ),
  },

  // ── finance.bank_account ───────────────────────────────────
  "finance.bank_account.created": {
    icon: CreditCard,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildHeadline: (e) => (
      <>
        создал(а) счёт{" "}
        <strong className="font-medium">«{bankAccountName(e)}»</strong>
      </>
    ),
  },
  "finance.bank_account.updated": {
    icon: Pencil,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => (
      <>
        изменил(а) счёт{" "}
        <strong className="font-medium">«{bankAccountName(e)}»</strong>
      </>
    ),
    buildDetails: (e) => <ChangeLines details={e.details} />,
  },
  "finance.bank_account.archived": {
    icon: Archive,
    iconClass: "text-muted-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        архивировал(а) счёт{" "}
        <strong className="font-medium">«{bankAccountName(e)}»</strong>
      </>
    ),
  },
  "finance.bank_account.restored": {
    icon: RotateCcw,
    iconClass: "text-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        восстановил(а) счёт{" "}
        <strong className="font-medium">«{bankAccountName(e)}»</strong>
      </>
    ),
  },

  // ── finance.category ───────────────────────────────────────
  "finance.category.created": {
    icon: Tag,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildHeadline: (e) => {
      const t = e.details.type as string | undefined;
      const typeLabel = t === "income" ? "доходов" : t === "expense" ? "расходов" : "";
      return (
        <>
          создал(а) статью {typeLabel && <span className="text-muted-foreground">{typeLabel} </span>}
          <strong className="font-medium">«{categoryName(e)}»</strong>
        </>
      );
    },
  },
  "finance.category.updated": {
    icon: Pencil,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => (
      <>
        изменил(а) статью{" "}
        <strong className="font-medium">«{categoryName(e)}»</strong>
      </>
    ),
    buildDetails: (e) => <ChangeLines details={e.details} />,
  },
  "finance.category.archived": {
    icon: Archive,
    iconClass: "text-muted-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        архивировал(а) статью{" "}
        <strong className="font-medium">«{categoryName(e)}»</strong>
      </>
    ),
  },
  "finance.category.restored": {
    icon: RotateCcw,
    iconClass: "text-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        восстановил(а) статью{" "}
        <strong className="font-medium">«{categoryName(e)}»</strong>
      </>
    ),
  },

  // ── finance.counterparty ───────────────────────────────────
  "finance.counterparty.created": {
    icon: Building2,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildHeadline: (e) => {
      const inn = e.details.inn as string | undefined;
      return (
        <>
          добавил(а) контрагента{" "}
          <strong className="font-medium">«{counterpartyName(e)}»</strong>
          {inn && <span className="text-muted-foreground"> (ИНН {inn})</span>}
        </>
      );
    },
  },
  "finance.counterparty.updated": {
    icon: Pencil,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => (
      <>
        изменил(а) контрагента{" "}
        <strong className="font-medium">«{counterpartyName(e)}»</strong>
      </>
    ),
    buildDetails: (e) => <ChangeLines details={e.details} />,
  },
  "finance.counterparty.archived": {
    icon: Archive,
    iconClass: "text-muted-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        архивировал(а) контрагента{" "}
        <strong className="font-medium">«{counterpartyName(e)}»</strong>
      </>
    ),
  },
  "finance.counterparty.restored": {
    icon: RotateCcw,
    iconClass: "text-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        восстановил(а) контрагента{" "}
        <strong className="font-medium">«{counterpartyName(e)}»</strong>
      </>
    ),
  },

  // ── kb_page ─────────────────────────────────────────────────
  // Используется только в общем журнале /org/audit. Страница
  // /knowledge/audit продолжает использовать свой KbAuditEventRow.
  "kb_page.created": {
    icon: FilePlus2,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildHeadline: (e) => (
      <>
        создал(а) страницу{" "}
        <strong className="font-medium">
          «{(e.details.title as string) || "Без названия"}»
        </strong>
      </>
    ),
  },
  "kb_page.renamed": {
    icon: FileEdit,
    iconClass: "text-blue-600 bg-blue-50",
    buildHeadline: (e) => (
      <>
        переименовал(а):{" "}
        <span className="text-muted-foreground line-through">
          {(e.details.old_title as string) || "Без названия"}
        </span>
        {" → "}
        <strong className="font-medium">
          {(e.details.new_title as string) || "Без названия"}
        </strong>
      </>
    ),
  },
  "kb_page.moved": {
    icon: ArrowRightFromLine,
    iconClass: "text-violet-600 bg-violet-50",
    buildHeadline: (e) => (
      <>
        переместил(а) страницу{" "}
        <strong className="font-medium">
          «{(e.details.title as string) || "Без названия"}»
        </strong>
      </>
    ),
  },
  "kb_page.deleted": {
    icon: Trash2,
    iconClass: "text-destructive bg-destructive/10",
    buildHeadline: (e) => (
      <>
        удалил(а) страницу{" "}
        <strong className="font-medium">
          «{(e.details.title as string) || "Без названия"}»
        </strong>
      </>
    ),
  },
  "kb_page.restored": {
    icon: RotateCcw,
    iconClass: "text-foreground bg-muted",
    buildHeadline: (e) => (
      <>
        восстановил(а) страницу{" "}
        <strong className="font-medium">
          «{(e.details.title as string) || "Без названия"}»
        </strong>{" "}
        из корзины
      </>
    ),
  },
  "kb_page.required_reading_toggled": {
    icon: BookOpen,
    iconClass: "text-amber-600 bg-amber-50",
    buildHeadline: (e) => {
      const newValue = Boolean(
        (e.details as { new_value?: boolean; enabled?: boolean }).new_value ??
          (e.details as { enabled?: boolean }).enabled,
      );
      return (
        <>
          {newValue
            ? "пометил(а) как обязательную к прочтению страницу"
            : "снял(а) флаг обязательного прочтения со страницы"}{" "}
          <strong className="font-medium">
            «{(e.details.title as string) || "Без названия"}»
          </strong>
        </>
      );
    },
  },
};

export function describeAuditEvent(event: AuditEvent): {
  icon: LucideIcon;
  iconClass: string;
  headline: ReactNode;
  details: ReactNode | null;
} {
  const spec = SPECS[event.action_code];
  if (!spec) {
    return {
      icon: Activity,
      iconClass: "text-muted-foreground bg-muted",
      headline: (
        <span className="text-muted-foreground">{event.action_code}</span>
      ),
      details: null,
    };
  }
  return {
    icon: spec.icon,
    iconClass: spec.iconClass,
    headline: spec.buildHeadline(event),
    details: spec.buildDetails ? spec.buildDetails(event) : null,
  };
}

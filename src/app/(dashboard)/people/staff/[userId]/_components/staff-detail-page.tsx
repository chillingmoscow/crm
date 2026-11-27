/* eslint-disable @next/next/no-img-element */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { isStaffPlaceholderEmail } from "@/lib/people/staff-identity";
import {
  GENDER_LABEL,
  GENDER_OPTIONS,
  genderFormField,
  genderFormValue,
  isGender,
  type Gender,
} from "@/lib/people/gender";
import {
  decodeStaffDocumentName,
  staffDocumentProblem,
} from "@/lib/people/staff-document-name";
import {
  StaffDocumentUploadError,
  uploadStaffDocument,
} from "@/lib/people/staff-document-upload";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  Lock,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, ProfileTabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { ProfileHeader } from "@/components/shared/profile-header";
import {
  ProfileSection as FormSection,
  ProfileSectionAddButton,
} from "@/components/shared/profile-section";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { createClient } from "@/lib/supabase/client";
import { translateError } from "@/lib/i18n/translate-error";
import { listAuditEvents, type AuditEvent } from "@/lib/audit/list";
import { EmployeeDocuments, BasicMedicalCard } from "./employee-documents";
import { OfficialEmploymentSection } from "./official-employment-section";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import {
  fireStaff,
  restoreStaff,
  setImportedStaffEmailAndInvite,
  updateStaffProfile,
  changeStaffDocument,
} from "../../actions";
import { saveStaffCard, type StaffCardChanges } from "../save-actions";
import type { StaffProfile, StaffAccountDetails } from "../../actions";
import type { OfficialEmploymentData } from "../../official-actions";
import type { ActionResult } from "@/lib/actions/result";
import { MetricStrip, Metric } from "@/components/shared/metric-strip";
import { AnimatedMoney, AnimatedNumber } from "@/components/shared/animated-money";
import { ShiftHeatmap, formatHours } from "@/components/people/shift-heatmap";
import { tenureLabel } from "@/lib/people/staff-activity";
import { countRu } from "@/lib/format/plural";
import type { StaffMonthStats } from "@/lib/people/staff-card-stats";
import type { ShiftHeatmapData } from "@/lib/people/staff-card-stats";
import { getStaffShiftHeatmap } from "../activity-actions";

const schema = z.object({
  // Тир 1+2 — personal (profiles)
  first_name: z.string().min(1, "Обязательное поле"),
  last_name: z.string().min(1, "Обязательное поле"),
  phone: z.string().optional(),
  telegram_id: z.string().optional(),
  // Пол обязателен, пока личные поля правит админ: см. personalSchema.
  gender: z.string(),
  birth_date: z.string().optional(),
  address: z.string().optional(),

  // Тир 3 — account-scoped (staff_account_details)
  employment_date: z.string().min(1, "Укажите дату трудоустройства"),
  medical_book_number: z.string().optional(),
  medical_book_date: z.string().optional(),
  comment: z.string().optional(),

  // UVR (venue-specific)
  terminal_pin: z.string().optional(),
  role_id: z.string().min(1, "Выберите должность"),
});

type FormValues = z.infer<typeof schema>;

// Личные поля правит админ (сотрудник ещё не вошёл в Sheerly) — тогда пол
// обязателен. Зарегистрированный ведёт пол сам, и его пустой пол не должен
// мешать админу сохранить HR-поля карточки.
const personalSchema = schema.extend({ gender: genderFormField });

type Role = { id: string; name: string; code: string };

import { StaffPayPanel } from "@/app/(dashboard)/people/payroll/_components/payroll-context";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProfileDangerAction } from "@/components/shared/profile-danger-zone";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { SaveBarScope, SaveBarSection } from "@/components/shared/save-bar";

type TabKey = "pay" | "main" | "documents" | "history" | "activity" | "danger";

interface Props {
  candidateId?: string | null;
  doorCode?: ReactNode;
  terminationStatus?: ReactNode;
  profile: StaffProfile;
  accountDetails: StaffAccountDetails;
  accountId: string;
  email: string;
  uvrId: string;
  /** Сегодняшняя дата в часовом поясе заведения (YYYY-MM-DD). */
  venueToday: string;
  roleId: string;
  roleName: string;
  /** code текущей роли. owner (системная) через staff-UI не меняется —
   *  при roleCode==='owner' селектор должности read-only. */
  roleCode: string;
  departmentId: string | null;
  departmentName: string | null;
  /** null и без права people.edit_staff: PIN виден только с этим правом. */
  terminalPin: string | null;
  venueId: string;
  roles: Role[];
  canEdit: boolean;
  isFired: boolean;
  firedAt: string | null;
  firedReason: string | null;
  isMe: boolean;
  /** Сотрудник — владелец аккаунта: уволить его нельзя. */
  isAccountOwner: boolean;
  importedFromQuickResto: boolean;
  joinedAt: string | null;
  userCreatedAt: string | null;
  /** auth.users.email_confirmed_at !== null. Если false — приглашение
   *  отправлено, но юзер ещё не подтвердил email. Админ может перепослать
   *  на другой адрес, если ошибся. */
  emailConfirmed: boolean;
  /** Есть ли неотозванное приглашение на email этого юзера. Надёжный признак
   *  «приглашён, но не активировал» для импортированного сотрудника, у
   *  которого email_confirmed может остаться true после смены email. */
  hasPendingInvite: boolean;
  /** user_metadata.needs_password_setup === true. Ещё один надёжный признак
   *  «приглашён, но не активировал»: флаг ставится при выдаче приглашения и
   *  снимается при успешной активации. Переживает потерю строки-инвайта. */
  needsPasswordSetup: boolean;
  /** Видит ли текущий юзер табы «Журнал» / «Активность». Проверка
   *  `org.view_audit` выполняется на сервере; здесь — флаг для
   *  conditional render'а. */
  canViewAudit: boolean;
  canConfigurePayroll: boolean;
  /** Блок «Официальное трудоустройство»; null — нет права просмотра зарплаты. */
  officialEmployment: ActionResult<OfficialEmploymentData> | null;
  /** Открытое официальное оформление в заведении: дата начала и «сегодня»
   *  по поясу аккаунта. Есть — окно увольнения спрашивает дату официального
   *  увольнения. Не зависит от права просмотра зарплаты. */
  officialTermination?: { startsOn: string; today: string } | null;
  /** Показывать ли вкладку «Оплата»: право на зарплату или своя карточка. */
  canViewPay: boolean;
  initialTab?: "main" | "documents" | "pay";
  /** Сейчас на смене (график и отметки): точка на аватаре. */
  onShift?: boolean;
  /** Смены и «Начислено» за текущий месяц — по правам на график и зарплату. */
  monthStats?: StaffMonthStats | null;
  /** Право на график или зарплату: тепловая карта смен во вкладке «Активность». */
  canViewShiftHeatmap?: boolean;
  /** Куда ведёт хлебная крошка «назад». По умолчанию — список сотрудников.
   *  Может переопределяться контекстом перехода (например, из акта
   *  инвентаризации через ?from=inventory). */
  backHref?: string;
  backLabel?: string;
}

// ── Helpers ───────────────────────────────────────────────────
const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" });
/** «ноябрь» для «Начислено за ноябрь». */
const monthName = (month: string) => monthFormat.format(new Date(`${month.slice(0, 7)}-15T12:00:00Z`));

/** Что входит в журнал сотрудника (см. `listAuditEvents` для `staff`):
 *  сама карточка, участие в зарплатном учёте, медкнижка и сведения для
 *  автоматизаций, рабочая форма. Варианты фильтра «Раздел». */
const STAFF_JOURNAL_SECTIONS = [
  { value: "staff", label: "Данные сотрудника" },
  { value: "payroll_employee", label: "Участие в зарплатном учёте" },
  { value: "payroll_automation_person", label: "Медкнижка и сведения для автоматизаций" },
  { value: "payroll_uniform", label: "Рабочая форма" },
  { value: "payroll_official_employment", label: "Официальное трудоустройство" },
];

type JournalKind = "history" | "activity";
type JournalPage = { events: AuditEvent[]; hasMore: boolean };
type JournalState = { page: JournalPage | null; failed: boolean };
const EMPTY_JOURNAL: JournalState = { page: null, failed: false };

/** Та же лента: фоновое обновление не пересоздаёт её и не сбрасывает фильтры. */
function sameJournalPage(prev: JournalPage | null, next: JournalPage) {
  return (
    prev !== null &&
    prev.hasMore === next.hasMore &&
    prev.events.length === next.events.length &&
    prev.events.every((event, i) => event.id === next.events[i]?.id)
  );
}

/** Первая загрузка ленты — скелетон по форме (фильтры, день, строки
 *  событий); ошибка — блок с повтором. */
function JournalPlaceholder({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          Не удалось загрузить события
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw className="mr-2 size-3.5" />
            Повторить
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div
      className="mx-auto flex w-full max-w-[720px] flex-col gap-4"
      aria-busy
      aria-label="Загружаем события"
    >
      <div className="flex gap-2">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="mx-1 h-4 w-24" />
        <ul className="flex flex-col overflow-hidden rounded-[14px] border bg-card">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <Skeleton className="mt-0.5 size-8 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-4 w-3/4 max-w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────


export function StaffDetailPage({
  candidateId,
  doorCode,
  terminationStatus,
  profile,
  accountDetails,
  accountId,
  email,
  uvrId,
  roleId,
  venueToday,
  roleName,
  roleCode,
  departmentId,
  departmentName,
  terminalPin,
  venueId,
  roles,
  canEdit: canEditProp,
  isFired,
  firedAt,
  firedReason,
  isMe,
  isAccountOwner,
  importedFromQuickResto,
  joinedAt,
  userCreatedAt,
  emailConfirmed,
  hasPendingInvite,
  needsPasswordSetup,
  canViewAudit,
  canConfigurePayroll,
  officialEmployment,
  officialTermination = null,
  canViewPay,
  initialTab = "main",
  onShift = false,
  monthStats = null,
  canViewShiftHeatmap = false,
  backHref = "/people/staff",
  backLabel = "Сотрудники",
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>(
    initialTab === "pay" && !canViewPay ? "main" : initialTab,
  );
  // «Журнал» и «Активность» грузятся при открытии вкладки, а не в рендере
  // карточки: первая загрузка — скелетон, повторное открытие показывает
  // прежнюю ленту сразу и тихо обновляет её в фоне.
  const [journal, setJournal] = useState<Record<JournalKind, JournalState>>({
    history: EMPTY_JOURNAL,
    activity: EMPTY_JOURNAL,
  });
  const journalRequest = useRef<Record<JournalKind, number>>({
    history: 0,
    activity: 0,
  });
  const loadJournal = useCallback(
    (kind: JournalKind) => {
      if (!canViewAudit) return;
      const id = ++journalRequest.current[kind];
      const settle = (next: (prev: JournalState) => JournalState) => {
        if (id !== journalRequest.current[kind]) return;
        setJournal((all) => {
          const value = next(all[kind]);
          return value === all[kind] ? all : { ...all, [kind]: value };
        });
      };
      // Ошибка видна, только если показать нечего; иначе остаётся прежняя лента.
      const fail = () =>
        settle((prev) => (prev.page ? prev : { page: null, failed: true }));
      settle((prev) => (prev.failed ? { page: null, failed: false } : prev));
      listAuditEvents(
        kind === "history"
          ? { entityType: "staff", entityId: profile.id }
          : { filterGroups: [{ actorIds: [profile.id] }] },
      )
        .then((result) => {
          if (result.error) return fail();
          settle((prev) =>
            sameJournalPage(prev.page, result)
              ? prev
              : { page: { events: result.events, hasMore: result.hasMore }, failed: false },
          );
        })
        .catch(fail);
    },
    [canViewAudit, profile.id],
  );
  // Документы, оплата и сохранение карточки пишут в журнал: открытую ленту
  // обновляем, закрытая обновится при следующем открытии.
  const refreshDocumentHistory = () => {
    if (activeTab === "history" || activeTab === "activity")
      loadJournal(activeTab);
  };
  // Тепловая карта смен — при открытии «Активности», как и лента событий.
  // denied — сервер ответил «нечего показать» (права на график и зарплату
  // сняли, пока карточка была открыта): иначе скелетон висел бы вечно.
  const [heatmap, setHeatmap] = useState<{
    data: ShiftHeatmapData | null;
    failed: boolean;
    denied?: boolean;
  }>({ data: null, failed: false });
  const heatmapRequested = useRef(false);
  const loadHeatmap = useCallback(() => {
    if (!canViewShiftHeatmap) return;
    heatmapRequested.current = true;
    setHeatmap((prev) => (prev.failed ? { data: null, failed: false } : prev));
    getStaffShiftHeatmap(profile.id)
      .then((result) =>
        setHeatmap((prev) =>
          result.ok
            ? result.data
              ? { data: result.data, failed: false }
              : { data: null, failed: false, denied: true }
            : prev.data
              ? prev
              : { data: null, failed: true },
        ),
      )
      .catch(() => setHeatmap((prev) => (prev.data ? prev : { data: null, failed: true })));
  }, [canViewShiftHeatmap, profile.id]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [passportPhotos, setPassportPhotos] = useState<string[]>(
    accountDetails.passport_photos ?? [],
  );
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [confirmFire, setConfirmFire] = useState(false);
  const [fireReason, setFireReason] = useState("");
  const [fireError, setFireError] = useState<string | null>(null);
  // Дата официального увольнения: по умолчанию сегодня, но не раньше оформления.
  const officialEndDefault = officialTermination
    ? officialTermination.today < officialTermination.startsOn
      ? officialTermination.startsOn
      : officialTermination.today
    : "";
  const [officialEnd, setOfficialEnd] = useState(officialEndDefault);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmPhotoDelete, setConfirmPhotoDelete] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  // Дата, с которой новая должность действует в зарплате (по умолчанию сегодня).
  const [roleValidFrom, setRoleValidFrom] = useState(venueToday);
  const [savingMain, setSavingMain] = useState(false);
  // «Документы» после первого открытия остаются смонтированными: правка
  // медкнижки не пропадает при переходе на другую вкладку, а полоса
  // сохранения продолжает её показывать.
  const [documentsVisited, setDocumentsVisited] = useState(
    initialTab === "documents",
  );
  const [isPending, startTransition] = useTransition();
  const [isInvitePending, startInviteTransition] = useTransition();
  // Если у юзера technical placeholder email — показываем пустое поле,
  // админ впишет реальный для invite. Иначе — реальный email юзера.
  const [contactEmail, setContactEmail] = useState(
    isStaffPlaceholderEmail(email) ? "" : email,
  );

  // Modals
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docName, setDocName] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Статус юзера определяет, кто ведёт его данные:
  //   placeholder — сотрудник без аккаунта (QR-импорт или ручное создание),
  //                 email = *@import.local. Админ ведёт всё за него.
  //   pending     — приглашение отправлено, email реальный, но юзер ещё
  //                 не подтвердил его (auth.users.email_confirmed_at = null).
  //                 Админ ещё может поменять email и переслать — на случай
  //                 опечатки.
  //   registered  — юзер подтвердил email хотя бы раз. С этого момента
  //                 он сам управляет своим профилем.
  const isPlaceholderUser = isStaffPlaceholderEmail(email);
  // pending — есть неотозванное приглашение, ЛИБО стоит флаг
  // needs_password_setup, ЛИБО email ещё не подтверждён. hasPendingInvite и
  // needsPasswordSetup надёжнее emailConfirmed: у импортированного сотрудника
  // после смены email подтверждение может остаться true, а активацию он не
  // прошёл. needs_password_setup переживает потерю строки-инвайта (прежний
  // инвайт мог уничтожиться старым багом переотправки до #441), поэтому
  // ловит случай «приглашён, ссылка не сработала, инвайта в таблице уже нет».
  const isPendingInvite =
    !isPlaceholderUser &&
    (hasPendingInvite || needsPasswordSetup || !emailConfirmed);
  const isRegisteredUser =
    !isPlaceholderUser &&
    emailConfirmed &&
    !hasPendingInvite &&
    !needsPasswordSetup;

  const displayName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    (isPlaceholderUser ? "Без имени" : contactEmail);
  // Стаж — от даты трудоустройства, без неё — с прихода в заведение.
  const tenure = isFired
    ? null
    : tenureLabel(accountDetails.employment_date ?? joinedAt, venueToday);

  // Уволенный сотрудник — карточку можно открыть и просмотреть, но
  // редактировать поля нельзя (кроме явных действий типа «Восстановить»).
  // Поэтому маскируем canEdit для всей формы; восстановление и просмотр
  // используют canManageStaff (исходный prop).
  const canManageStaff = canEditProp;
  const canEdit = canEditProp && !isFired;

  // Смена должности: владелец (owner) через staff-UI не переназначается —
  // это единственная системная роль, привязанная к владельцу аккаунта, и
  // её нет в списке venue-ролей. Для всех остальных — обычный edit-гейт.
  const canEditRole = canEdit && roleCode !== "owner";

  // Email-поле и кнопку «Пригласить»/«Изменить и переслать» админ видит,
  // пока сотрудник не подтвердил email. После — read-only.
  const canManageImportedInvite =
    (isPlaceholderUser || isPendingInvite) && canEdit && !isMe;

  // Личные поля редактируются админом только пока юзер не зарегистрирован
  // (placeholder ИЛИ pending invite). Как только сотрудник подтвердил email
  // и вошёл в систему — он сам управляет профилем.
  const canEditPersonal = canEdit && !isRegisteredUser;

  // «Опасная зона» показывается, только когда увольнение доступно: уволенного
  // уволить нельзя, себя тоже, владельца аккаунта — тоже (база откажет).
  const canFire = canEdit && !isMe && !isAccountOwner;

  // PIN кассы видит и меняет только тот, кто может редактировать
  // сотрудников (то же правило, что в списке). Сервер без этого права PIN
  // в карточку не передаёт.
  const canSeePin = canManageStaff;

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(canEditPersonal ? personalSchema : schema),
    defaultValues: {
      first_name: profile.first_name ?? "",
      last_name: profile.last_name ?? "",
      phone: profile.phone ?? "",
      telegram_id: profile.telegram_id ?? "",
      gender: genderFormValue(profile.gender),
      birth_date: profile.birth_date ?? "",
      address: profile.address ?? "",
      employment_date: accountDetails.employment_date ?? "",
      medical_book_number: accountDetails.medical_book_number ?? "",
      medical_book_date: accountDetails.medical_book_date ?? "",
      comment: accountDetails.comment ?? "",
      terminal_pin: terminalPin ?? "",
      role_id: roleId,
    },
  });

  // Синхронизация формы с сервером после router.refresh() / window.reload.
  // Без этого useForm защёлкивается на defaultValues из первого рендера, и
  // когда parent server-component возвращает свежие props после save —
  // форма продолжает показывать старые значения. Зависимости — те же
  // primitive-поля, которые мы кладём в defaultValues; ref-ы (registers)
  // не нужны.
  useEffect(() => {
    reset({
      first_name: profile.first_name ?? "",
      last_name: profile.last_name ?? "",
      phone: profile.phone ?? "",
      telegram_id: profile.telegram_id ?? "",
      gender: genderFormValue(profile.gender),
      birth_date: profile.birth_date ?? "",
      address: profile.address ?? "",
      employment_date: accountDetails.employment_date ?? "",
      medical_book_number: accountDetails.medical_book_number ?? "",
      medical_book_date: accountDetails.medical_book_date ?? "",
      comment: accountDetails.comment ?? "",
      terminal_pin: terminalPin ?? "",
      role_id: roleId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile.first_name,
    profile.last_name,
    profile.phone,
    profile.telegram_id,
    profile.gender,
    profile.birth_date,
    profile.address,
    accountDetails.employment_date,
    accountDetails.medical_book_number,
    accountDetails.medical_book_date,
    accountDetails.comment,
    terminalPin,
    roleId,
  ]);

  // Generate signed URLs for passport photos
  useEffect(() => {
    if (!passportPhotos.length) {
      setSignedUrls({});
      return;
    }
    const supabase = createClient();
    Promise.all(
      passportPhotos.map(async (path) => {
        const { data } = await supabase.storage
          .from("staff-documents")
          .createSignedUrl(path, 3600);
        return { path, url: data?.signedUrl ?? "" };
      }),
    ).then((results) =>
      setSignedUrls(Object.fromEntries(results.map((r) => [r.path, r.url]))),
    );
  }, [passportPhotos]);

  // Какие schema-поля лежат на каком табе. Используется в onValidationError
  // чтобы переключить юзера на нужный таб, если zod-валидация упала на
  // полях невидимого таба (раньше клик «Сохранить» просто не давал
  // никакого фидбэка — silent failure).
  const FIELD_TAB: Record<keyof FormValues, TabKey> = {
    first_name: "main",
    last_name: "main",
    phone: "main",
    telegram_id: "main",
    gender: "main",
    birth_date: "main",
    address: "main",
    employment_date: "main",
    terminal_pin: "main",
    role_id: "main",
    medical_book_number: "documents",
    medical_book_date: "documents",
    comment: "main",
  };

  const onValidationError = (formErrors: typeof errors) => {
    const firstField = Object.keys(formErrors)[0] as
      | keyof FormValues
      | undefined;
    if (!firstField) return;
    const targetTab = FIELD_TAB[firstField] ?? "main";
    if (targetTab !== activeTab) setActiveTab(targetTab);
    const message =
      (formErrors[firstField] as { message?: string } | undefined)?.message ??
      "Заполните обязательные поля";
    toast.error(message);
  };

  const watchedRoleId = watch("role_id");

  // Save: одна команда saveStaffCard получает только изменённые части
  // (личные поля — если их правит админ, данные аккаунта, PIN, должность —
  // если она реально изменилась и это не owner) и пишет их на сервере
  // параллельно. Свежие данные карточки приходят в ответе действия
  // (revalidatePath), отдельный router.refresh() не нужен.
  // Если упала хоть одна часть, показываем toast и не делаем общий «Сохранено».
  // Сохраняет полоса внизу колонки (SaveBar): она видна, пока форма
  // отличается от сохранённой.
  const persistMain = async (values: FormValues): Promise<boolean> => {
    const changed = (field: keyof FormValues) => Boolean(dirtyFields[field]);
    const changes: StaffCardChanges = { userId: profile.id, uvrId };

    // Личные поля пишем только если у нас на это есть право (placeholder-юзер).
    // Иначе их обновляет сам сотрудник через свой профиль.
    if (canEditPersonal) {
      const personal: NonNullable<StaffCardChanges["profile"]> = {};
      if (changed("first_name")) personal.first_name = values.first_name;
      if (changed("last_name")) personal.last_name = values.last_name;
      if (changed("phone")) personal.phone = values.phone || null;
      if (changed("telegram_id")) personal.telegram_id = values.telegram_id || null;
      if (changed("gender")) personal.gender = values.gender as Gender;
      if (changed("birth_date")) personal.birth_date = values.birth_date || null;
      if (changed("address")) personal.address = values.address || null;
      if (Object.keys(personal).length > 0) changes.profile = personal;
    }
    const details: NonNullable<StaffCardChanges["accountDetails"]> = {};
    if (changed("employment_date")) details.employment_date = values.employment_date;
    if (changed("comment")) details.comment = values.comment || null;
    if (Object.keys(details).length > 0) changes.accountDetails = details;
    if (canSeePin && changed("terminal_pin"))
      changes.terminalPin = values.terminal_pin || null;
    if (canEditRole && values.role_id !== roleId)
      changes.role = { roleId: values.role_id, validFrom: roleValidFrom };

    const saved = () => {
      // Сохранённые значения становятся исходными: полоса пропадает сразу,
      // не дожидаясь свежих данных с сервера.
      reset(values);
      setRoleValidFrom(venueToday);
    };
    if (
      !changes.profile &&
      !changes.accountDetails &&
      changes.terminalPin === undefined &&
      !changes.role
    ) {
      saved();
      return true;
    }

    setSavingMain(true);
    try {
      const result = await saveStaffCard(changes);
      if (result.error) {
        toast.error(result.error);
        return false;
      }
      saved();
      toast.success("Данные сохранены");
      for (const notice of result.notices ?? []) toast.warning(notice);
      // Журнал карточки уже открывали — обновим его тихо.
      refreshDocumentHistory();
      return true;
    } catch {
      toast.error("Не удалось сохранить данные. Проверьте подключение и повторите");
      return false;
    } finally {
      setSavingMain(false);
    }
  };

  const saveMain = () =>
    new Promise<boolean>((resolve) => {
      void handleSubmit(
        async (values) => resolve(await persistMain(values)),
        (formErrors) => {
          onValidationError(formErrors);
          resolve(false);
        },
      )();
    });

  const resetMain = () => {
    reset();
    setRoleValidFrom(venueToday);
  };

  const submitAvatarModal = async () => {
    if (!photoFile) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(photoFile.type) ||
      photoFile.size > 5 * 1024 * 1024
    ) {
      toast.error("Выберите JPG, PNG или WebP размером до 5 МБ");
      return;
    }
    setUploadingAvatar(true);
    try {
      const supabase = createClient();
      const path = `${profile.id}/avatar`;
      // 60s timeout — защита от «зависает на загрузке» (Supabase storage
      // не отвечает): юзер получит понятный тост вместо вечного спиннера.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      let uploadError: Error | null = null;
      try {
        const { error } = await supabase.storage
          .from("avatars")
          .upload(path, photoFile, {
            upsert: true,
            contentType: photoFile.type,
            // @ts-expect-error — supabase-js v2 поддерживает signal через
            // fetch-init; типы пока не покрывают это поле.
            signal: ctrl.signal,
          });
        if (error) uploadError = new Error(error.message);
      } catch (e) {
        uploadError = e instanceof Error ? e : new Error(String(e));
      } finally {
        clearTimeout(timer);
      }
      if (uploadError) {
        toast.error(
          ctrl.signal.aborted
            ? "Загрузка заняла больше минуты. Проверьте подключение и попробуйте снова."
            : translateError(uploadError.message),
        );
        return;
      }
      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);
      const newUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const result = await updateStaffProfile(profile.id, {
        avatar_url: newUrl,
      });
      if (result.error) {
        toast.error(translateError(result.error));
        return;
      }
      setAvatarUrl(newUrl);
      setPhotoModalOpen(false);
      setPhotoFile(null);
      toast.success("Фото обновлено");
    } finally {
      setUploadingAvatar(false);
    }
  };

  // Удаление фото необратимо: вернуть его можно только повторной загрузкой.
  const deleteAvatar = async () => {
    setDeletingPhoto(true);
    try {
      const result = await updateStaffProfile(profile.id, { avatar_url: null });
      if (result.error) {
        toast.error(translateError(result.error));
        return;
      }
      setAvatarUrl(null);
      setConfirmPhotoDelete(false);
      setPhotoModalOpen(false);
      setPhotoFile(null);
      toast.success("Фото удалено");
    } catch {
      toast.error("Не удалось удалить фото. Проверьте подключение и повторите");
    } finally {
      setDeletingPhoto(false);
    }
  };

  // Display name is reversible ASCII; user filenames never become storage paths.
  const submitDocModal = async () => {
    if (!docFile) return;
    const problem = staffDocumentProblem(docFile, docName);
    if (problem) {
      toast.error(problem);
      return;
    }
    setUploadingDocs(true);
    try {
      const { paths } = await uploadStaffDocument({
        venueId, userId: profile.id, accountId, name: docName, file: docFile, expectedPaths: passportPhotos,
      });
      setPassportPhotos(paths);
      setDocModalOpen(false);
      setDocName("");
      setDocFile(null);
      toast.success("Документ добавлен");
    } catch (error) {
      toast.error(
        error instanceof StaffDocumentUploadError
          ? error.message
          : "Не удалось завершить загрузку. Обновите карточку, чтобы проверить документы",
      );
    } finally {
      setUploadingDocs(false);
    }
  };

  // Удаление документа необратимо: сначала спрашиваем, какой именно удаляем.
  const [docToDelete, setDocToDelete] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);
  const handleDeletePassportPhoto = async (path: string) => {
    setDeletingDoc(true);
    try {
      const result = await changeStaffDocument({
        userId: profile.id, accountId, expectedPaths: passportPhotos, removePath: path,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setPassportPhotos(result.paths ?? passportPhotos.filter((p) => p !== path));
      setDocToDelete(null);
      toast.success("Документ удалён");
    } finally {
      setDeletingDoc(false);
    }
  };

  const handleFire = () => {
    const reason = fireReason.trim();
    if (!reason) {
      toast.error("Укажите причину увольнения");
      return;
    }
    if (officialTermination && !officialEnd) {
      setFireError("Укажите дату официального увольнения");
      return;
    }
    setFireError(null);
    startTransition(async () => {
      const result = await fireStaff(uvrId, reason, officialTermination ? officialEnd : null);
      if (result.error) {
        setFireError(result.error);
        router.refresh();
        return;
      }
      setConfirmFire(false);
      toast.success("Сотрудник уволен");
      router.push("/people/staff");
    });
  };

  const handleRestore = () => {
    startTransition(async () => {
      const result = await restoreStaff(uvrId);
      setConfirmRestore(false);
      if (result.error) {
        toast.error(translateError(result.error));
        // An unfinished restore shows its state and «Повторить» on the card.
        router.refresh();
        return;
      }
      toast.success("Сотрудник восстановлен");
      router.refresh();
    });
  };

  const handleInviteImported = () => {
    if (!canManageImportedInvite) return;

    startInviteTransition(async () => {
      // Для placeholder-юзеров всегда нужно установить реальный email + invite.
      // (Старый ветка с inviteImportedStaffByCurrentEmail работала с
      // QR-импортированными у которых был «случайно» реальный email — но в
      // новой модели это редкий кейс, флоу одинаковый.)
      const result = await setImportedStaffEmailAndInvite({
        userId: profile.id,
        email: contactEmail,
        roleId,
        venueId,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Приглашение отправлено на ${contactEmail}`);
      router.refresh();
    });
  };

  // Парсит filename storage-пути:
  //   `${ts}__${encName}__${origFilename}` → user-introduced name (новый формат)
  //   `${ts}_${origFilename}` или `origFilename` → fallback на имя файла
  const parseDocPath = (
    path: string,
  ): { name: string; uploadedAt: string | null } => {
    const last = path.split("/").pop() ?? path;
    const newFormat = last.match(/^(\d+)__([^_]+)__(.+)$/);
    if (newFormat) {
      const ts = Number(newFormat[1]);
      let displayName = "";
      try {
        displayName = decodeStaffDocumentName(newFormat[2]);
      } catch {
        displayName = newFormat[3];
      }
      return {
        name: displayName || newFormat[3],
        uploadedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      };
    }
    const legacy = last.match(/^(\d+)_(.+)$/);
    if (legacy) {
      const ts = Number(legacy[1]);
      return {
        name: legacy[2],
        uploadedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      };
    }
    return { name: last, uploadedAt: null };
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <Breadcrumbs
        back={
          backHref === "/people/staff"
            ? undefined
            : { href: backHref, label: backLabel }
        }
        items={[
          { label: "Люди" },
          { label: "Сотрудники", href: "/people/staff" },
          { label: displayName },
        ]}
      />

      <PageHeaderActions>
        {isFired && canManageStaff && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmRestore(true)}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            Восстановить
          </Button>
        )}
        <EntityInfoPopover
          title="О сотруднике"
          id={profile.id}
          createdLabel="Аккаунт создан"
          createdAt={userCreatedAt}
          createdByName={null}
          updatedLabel="В заведении с"
          updatedAt={joinedAt}
          updatedByName={null}
        />
      </PageHeaderActions>

      <ProfilePageFrame>
        <SaveBarScope>
        <SaveBarSection
          dirty={canEdit && isDirty}
          saving={savingMain}
          save={saveMain}
          reset={resetMain}
        />
        <ProfileHeader
          name={displayName}
          avatarUrl={avatarUrl}
          flightId={profile.id}
          avatarBadge={
            onShift && !isFired ? (
              <span
                role="img"
                aria-label="Сейчас на смене"
                data-tip="Сейчас на смене"
                className={
                  // Справа внизу у редактируемого аватара — значок камеры.
                  canEditPersonal
                    ? "absolute right-0 top-0 size-3.5 rounded-full bg-green-500 ring-2 ring-background"
                    : "absolute bottom-0 right-0 size-3.5 rounded-full bg-green-500 ring-2 ring-background"
                }
              />
            ) : null
          }
          wrapName
          avatarEdit={
            canEditPersonal
              ? {
                  label: avatarUrl ? "Изменить фото" : "Загрузить фото",
                  onClick: () => setPhotoModalOpen(true),
                }
              : undefined
          }
        >
          <span className="text-sm text-muted-foreground">
            {roleName}
            {departmentName && (
              <>
                {" · "}
                {departmentId ? (
                  <Link
                    href={`/people/departments/${departmentId}`}
                    className="transition-colors duration-200 hover:text-brand"
                  >
                    {departmentName}
                  </Link>
                ) : (
                  departmentName
                )}
              </>
            )}
            {tenure && ` · ${tenure}`}
          </span>
          {isFired ? (
            <StatusBadge>
              Уволен{firedAt ? ` · ${formatDate(firedAt)}` : ""}
            </StatusBadge>
          ) : isPlaceholderUser ? (
            <StatusBadge>Без аккаунта</StatusBadge>
          ) : isPendingInvite ? (
            <StatusBadge tone="warning">Ожидает подтверждения</StatusBadge>
          ) : (
            <StatusBadge tone="success">Активен</StatusBadge>
          )}
          {importedFromQuickResto && (
            <StatusBadge tone="info">Из Quick Resto</StatusBadge>
          )}
        </ProfileHeader>

        {monthStats && (monthStats.shifts || monthStats.earned !== undefined) && (
          <MetricStrip label={`Итоги за ${monthName(monthStats.month)}`}>
            {monthStats.earned !== undefined && (
              <Metric
                primary
                label={`Начислено за ${monthName(monthStats.month)}`}
                value={<AnimatedMoney value={monthStats.earned} />}
                hint={monthStats.earned === null ? "Часть начислений ещё не рассчитана" : undefined}
                onClick={canViewPay ? () => setActiveTab("pay") : undefined}
                ariaLabel={canViewPay ? "Начислено за месяц: открыть оплату" : undefined}
              />
            )}
            {monthStats.shifts && (
              <Metric
                label="Смены"
                value={<AnimatedNumber value={monthStats.shifts.done} />}
                hint={
                  monthStats.shifts.upcoming > 0
                    ? `Ещё ${countRu(monthStats.shifts.upcoming, "смена", "смены", "смен")} по графику`
                    : "По графику"
                }
              />
            )}
            {monthStats.shifts && (
              <Metric
                label="Часы"
                value={
                  <AnimatedNumber
                    value={monthStats.shifts.hours}
                    digits={1}
                    format={formatHours}
                  />
                }
                hint="Отработано по графику"
              />
            )}
          </MetricStrip>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            if (v === "documents") setDocumentsVisited(true);
            if (v === "history" || v === "activity") loadJournal(v);
            if (v === "activity" && !heatmapRequested.current) loadHeatmap();
            setActiveTab(v as TabKey);
          }}
        >
          <ProfileTabsList>
            <TabsTrigger value="main">Основное</TabsTrigger>
            <TabsTrigger value="documents">Документы</TabsTrigger>
            {canViewPay && <TabsTrigger value="pay">Оплата</TabsTrigger>}
            {canViewAudit && <TabsTrigger value="history">Журнал</TabsTrigger>}
            {(canViewAudit || canViewShiftHeatmap) && (
              <TabsTrigger value="activity">Активность</TabsTrigger>
            )}
            {canFire && (
              <TabsTrigger value="danger">Опасная зона</TabsTrigger>
            )}
          </ProfileTabsList>

          {/* ── Основное ─────────────────────────────────────── */}
          {/* Смонтирована всегда: несохранённые правки переживают
              переключение вкладок, полоса сохранения видна на любой. */}
          <TabsContent
            value="main"
            forceMount
            className="data-[state=inactive]:hidden"
          >
            <div className="flex flex-col gap-5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canEdit && isDirty) void saveMain();
              }}
              className="flex flex-col gap-5"
            >
              {/* Enter в поле сохраняет форму: без кнопки отправки форма
                  с несколькими полями по Enter не отправляется. Видимая
                  кнопка — в полосе сохранения. */}
              <button
                type="submit"
                tabIndex={-1}
                aria-hidden
                className="sr-only"
              />
              {isFired && (firedReason || terminationStatus) && (
                <FormSection title="Увольнение">
                  {firedReason && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        Причина увольнения
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {firedReason}
                      </p>
                    </div>
                  )}
                  {terminationStatus}
                </FormSection>
              )}
              {/* Фото меняется на аватаре в шапке карточки. */}
              <FormSection
                title="Личные данные"
                locked={{ tone: canEditPersonal ? "info" : "locked" }}
              >
                {/* Обязательные поля отмечены, только пока админ может их
                    править; зарегистрированный сотрудник ведёт их сам.
                    items-start: подсказка или ошибка под одним полем не
                    сдвигает соседнее в строке. */}
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  <Field
                    id="first_name"
                    label="Имя"
                    required={canEditPersonal}
                    error={errors.first_name?.message}
                  >
                    {(fieldProps) => (
                      <Input
                        {...fieldProps}
                        aria-required={canEditPersonal || undefined}
                        {...register("first_name")}
                        readOnly={!canEditPersonal}
                        className={!canEditPersonal ? "bg-muted/50" : ""}
                      />
                    )}
                  </Field>
                  <Field
                    id="last_name"
                    label="Фамилия"
                    required={canEditPersonal}
                    error={errors.last_name?.message}
                  >
                    {(fieldProps) => (
                      <Input
                        {...fieldProps}
                        aria-required={canEditPersonal || undefined}
                        {...register("last_name")}
                        readOnly={!canEditPersonal}
                        className={!canEditPersonal ? "bg-muted/50" : ""}
                      />
                    )}
                  </Field>
                  <Field
                    id="gender"
                    label="Пол"
                    required={canEditPersonal}
                    error={errors.gender?.message}
                    hint={
                      !canEditPersonal && !isGender(profile.gender)
                        ? "Сотрудник указывает пол сам, в своём профиле"
                        : undefined
                    }
                  >
                    {(fieldProps) =>
                      canEditPersonal ? (
                        <Controller
                          control={control}
                          name="gender"
                          render={({ field }) => (
                            <OptionSelect
                              {...fieldProps}
                              aria-required
                              value={field.value}
                              onValueChange={field.onChange}
                              placeholder="Выберите пол"
                              options={GENDER_OPTIONS}
                            />
                          )}
                        />
                      ) : (
                        <Input
                          {...fieldProps}
                          value={
                            isGender(profile.gender)
                              ? GENDER_LABEL[profile.gender]
                              : "Не указан"
                          }
                          readOnly
                          className="bg-muted/50"
                        />
                      )
                    }
                  </Field>
                  {/* Подпись «когда был последний раз изменён» — видна всем.
                      Социальный гард от фрода с ДР: если кто-то перевыставил
                      дату чтобы получить поздравление повторно, остальные
                      сотрудники видят, что дата свежая. Сам limit (раз в год)
                      живёт в trigger'е tg_profiles_birth_date_yearly_limit
                      (миграция 142) — это про UX, не про защиту. */}
                  <Field
                    id="birth_date"
                    label="Дата рождения"
                    hint={
                      profile.birth_date_set_at
                        ? `Изменено ${new Date(
                            profile.birth_date_set_at,
                          ).toLocaleDateString("ru-RU", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}`
                        : undefined
                    }
                  >
                    {(fieldProps) => (
                      <Controller
                        control={control}
                        name="birth_date"
                        render={({ field }) => (
                          <DatePicker
                            {...fieldProps}
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            placeholder="Выберите дату"
                            readOnly={!canEditPersonal}
                            toDate={new Date()}
                          />
                        )}
                      />
                    )}
                  </Field>
                </div>
              </FormSection>

              {/* Контакты — phone/telegram/email/адрес (всё user-owned) */}
              <FormSection
                title="Контакты"
                locked={{ tone: canEditPersonal ? "info" : "locked" }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-[13px] font-medium">
                      Телефон
                    </Label>
                    <Controller
                      control={control}
                      name="phone"
                      render={({ field }) => (
                        <PhoneInput
                          id="phone"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          readOnly={!canEditPersonal}
                          className={!canEditPersonal ? "bg-muted/50" : ""}
                        />
                      )}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label
                      htmlFor="staff_email"
                      className="text-[13px] font-medium"
                    >
                      Email
                      {isPendingInvite && (
                        <StatusBadge tone="warning" className="ml-2">
                          Ожидает подтверждения
                        </StatusBadge>
                      )}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="staff_email"
                        type="email"
                        value={contactEmail}
                        onChange={(event) =>
                          setContactEmail(event.target.value)
                        }
                        readOnly={!canManageImportedInvite}
                        className={
                          !canManageImportedInvite
                            ? "bg-muted/50 text-muted-foreground"
                            : ""
                        }
                        placeholder={
                          isPlaceholderUser
                            ? "Не указан"
                            : "employee@example.com"
                        }
                      />
                      {canManageImportedInvite && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleInviteImported}
                          disabled={isInvitePending || !contactEmail.trim()}
                          className="shrink-0"
                        >
                          {isInvitePending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                          ) : null}
                          {isPlaceholderUser
                            ? "Пригласить"
                            : contactEmail.trim().toLowerCase() ===
                                email.toLowerCase()
                              ? "Отправить повторно"
                              : "Изменить и переслать"}
                        </Button>
                      )}
                    </div>
                    {canManageImportedInvite && (
                      <p className="text-xs text-muted-foreground">
                        {isPendingInvite
                          ? "Приглашение отправлено, но сотрудник его пока не подтвердил. Можно отправить повторно (та же почта) или вписать другой email и переслать."
                          : "Введите email и отправьте приглашение, когда понадобится дать сотруднику доступ к системе."}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="telegram_id"
                      className="text-[13px] font-medium"
                    >
                      Telegram ID
                    </Label>
                    <Controller
                      control={control}
                      name="telegram_id"
                      render={({ field }) => (
                        <Input
                          id="telegram_id"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="123456789"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value.replace(/\D+/g, ""))
                          }
                          onBlur={field.onBlur}
                          readOnly={!canEditPersonal}
                          className={!canEditPersonal ? "bg-muted/50" : ""}
                        />
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="address"
                      className="text-[13px] font-medium"
                    >
                      Адрес проживания
                    </Label>
                    <Input
                      id="address"
                      placeholder="г. Москва, ул. Примерная, 1"
                      {...register("address")}
                      readOnly={!canEditPersonal}
                      className={!canEditPersonal ? "bg-muted/50" : ""}
                    />
                  </div>
                </div>
              </FormSection>

              {/* Трудоустройство + PIN — тир 3 (account) + UVR (venue) */}
              <FormSection
                title="Трудоустройство"
              >
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium">Должность</Label>
                  {canEditRole ? (
                    <Controller
                      control={control}
                      name="role_id"
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={(v) => {
                            field.onChange(v);
                            setRoleValidFrom(venueToday);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите должность" />
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  ) : (
                    <Input value={roleName} readOnly className="bg-muted/50" />
                  )}
                  {errors.role_id && (
                    <p className="text-xs text-destructive">
                      {errors.role_id.message}
                    </p>
                  )}
                </div>

                {canEditRole && watchedRoleId !== roleId && (
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="role_valid_from"
                      className="text-[13px] font-medium"
                    >
                      Действует с
                    </Label>
                    <DatePicker
                      id="role_valid_from"
                      value={roleValidFrom}
                      onChange={setRoleValidFrom}
                      clearable={false}
                    />
                    <p className="text-xs text-muted-foreground">
                      С этой даты у сотрудника меняется должность в зарплате.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="employment_date"
                      className="text-[13px] font-medium"
                    >
                      Дата трудоустройства{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Controller
                      control={control}
                      name="employment_date"
                      render={({ field }) => (
                        <DatePicker
                          id="employment_date"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder="Выберите дату"
                          readOnly={!canEdit}
                          toDate={new Date()}
                        />
                      )}
                    />
                    {errors.employment_date && (
                      <p className="text-xs text-destructive">
                        {errors.employment_date.message}
                      </p>
                    )}
                  </div>
                  {canSeePin && (
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="terminal_pin"
                        className="text-[13px] font-medium"
                      >
                        PIN кассы
                      </Label>
                      <Input
                        id="terminal_pin"
                        placeholder="Не задан"
                        {...register("terminal_pin")}
                        readOnly={!canEdit}
                        className={!canEdit ? "bg-muted/50" : ""}
                      />
                    </div>
                  )}
                </div>
                {doorCode && <div className="border-t pt-4">{doorCode}</div>}
              </FormSection>
            </form>

              {/* Вне формы: у блока свои панели и команды, Enter в них не
                  сохраняет карточку. */}
              {officialEmployment && (
                <OfficialEmploymentSection
                  data={officialEmployment}
                  employeeName={displayName}
                  today={venueToday}
                  canAttachFiles={canManageStaff}
                  documents={{
                    venueId,
                    userId: profile.id,
                    accountId,
                    documentPaths: passportPhotos,
                    onDocumentsChange: setPassportPhotos,
                  }}
                />
              )}

              {/* Заметка — тир 3, видна только админам. Поле многострочное,
                  Enter его не отправляет — форма ему не нужна. */}
              <FormSection
                title="Заметка о сотруднике"
                description="Видна только админам этого аккаунта"
              >
                <Textarea
                  aria-label="Заметка о сотруднике"
                  {...register("comment")}
                  readOnly={!canEdit}
                  className={!canEdit ? "bg-muted/50" : ""}
                  placeholder="Заметки о сменах, характере, особенностях."
                  rows={4}
                />
              </FormSection>
            </div>
          </TabsContent>

          {/* ── Оплата ───────────────────────────────────────── */}
          {canViewPay && (
            <TabsContent value="pay">
              <StaffPayPanel userId={profile.id} />
              {canConfigurePayroll && (
                <div className="mx-auto mt-5 w-full max-w-[720px]">
                  <EmployeeDocuments
                    target={{ userId: profile.id }}
                    sections={["uniform"]}
                    onChanged={refreshDocumentHistory}
                  />
                </div>
              )}
            </TabsContent>
          )}

          {/* ── Документы ────────────────────────────────────── */}
          {/* После первого открытия остаётся смонтированной: правка медкнижки
              не теряется при переходе на другую вкладку. */}
          <TabsContent
            value="documents"
            forceMount={documentsVisited || undefined}
            className="data-[state=inactive]:hidden"
          >
            <div className="flex flex-col gap-5">
              {candidateId && (
                <FormSection title="Анкета кандидата">
                  <Link
                    href={`/people/candidates/${candidateId}`}
                    className="inline-flex items-center gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-muted/40"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      Анкета и история подбора
                    </span>
                    <span className="shrink-0 text-brand">Открыть</span>
                  </Link>
                </FormSection>
              )}
              {canConfigurePayroll ? (
                <EmployeeDocuments
                  target={{ userId: profile.id }}
                  // Покупки формы — во вкладке «Оплата», если она есть.
                  sections={canViewPay ? ["medical"] : ["medical", "uniform"]}
                  basic={{
                    userId: profile.id,
                    accountId,
                    number: accountDetails.medical_book_number,
                    until: accountDetails.medical_book_date,
                    canEdit,
                  }}
                  onChanged={refreshDocumentHistory}
                />
              ) : (
                <BasicMedicalCard
                  basic={{
                    userId: profile.id,
                    accountId,
                    number: accountDetails.medical_book_number,
                    until: accountDetails.medical_book_date,
                    canEdit,
                  }}
                  onChanged={refreshDocumentHistory}
                />
              )}

              <section className="rounded-[14px] border bg-card p-5 flex flex-col gap-4">
                <header className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <h2 className="text-base font-semibold text-foreground leading-tight">
                      Документы
                    </h2>
                    <p className="text-[13px] text-muted-foreground leading-snug">
                      Паспорт, трудовой договор, NDA и другие документы
                      сотрудника
                    </p>
                  </div>
                  {canEdit && (
                    <ProfileSectionAddButton
                      onClick={() => {
                        setDocName("");
                        setDocFile(null);
                        setDocModalOpen(true);
                      }}
                      className="shrink-0"
                    >
                      Добавить документ
                    </ProfileSectionAddButton>
                  )}
                </header>

                {passportPhotos.length === 0 ? (
                  <div className="rounded-xl border border-dashed flex flex-col items-center justify-center gap-1.5 py-8 px-4 text-muted-foreground">
                    <FileText className="w-5 h-5" />
                    <p className="text-[13px]">Документов пока нет</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {passportPhotos.map((path) => {
                      const url = signedUrls[path];
                      const { name, uploadedAt } = parseDocPath(path);
                      const last = path.split("/").pop() ?? "";
                      const isImage = /\.(jpe?g|png|webp|gif)$/i.test(last);
                      return (
                        <div
                          key={path}
                          className="relative group rounded-xl border bg-card p-4 flex flex-col gap-3 hover:border-foreground/20 transition-colors"
                        >
                          <div className="flex items-center justify-center h-20 rounded-lg bg-muted overflow-hidden">
                            {isImage && url ? (
                              <img
                                src={url}
                                alt={name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <FileText className="w-7 h-7 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <p className="text-[13px] font-medium text-foreground truncate">
                              {name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {uploadedAt
                                ? `Загружен ${formatDate(uploadedAt)}`
                                : "Файл"}
                            </p>
                            {url && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 text-[13px] text-brand hover:underline"
                                aria-label={`Открыть документ: ${name}`}
                              >
                                Открыть файл
                              </a>
                            )}
                          </div>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => setDocToDelete({ path, name })}
                              className="absolute top-2 right-2 size-6 rounded-md bg-background/90 border border-border text-muted-foreground hover:text-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                              aria-label={`Удалить документ: ${name}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </TabsContent>

          {/* ── Журнал (что делали с этим сотрудником) ──────── */}
          {canViewAudit && (
            <TabsContent value="history">
              {journal.history.page ? (
                <EntityAuditTab
                  mode="entity"
                  entityType="staff"
                  entityId={profile.id}
                  sections={STAFF_JOURNAL_SECTIONS}
                  canView={canViewAudit}
                  initialEvents={journal.history.page.events}
                  initialHasMore={journal.history.page.hasMore}
                />
              ) : (
                <JournalPlaceholder
                  failed={journal.history.failed}
                  onRetry={() => loadJournal("history")}
                />
              )}
            </TabsContent>
          )}

          {/* ── Активность: год смен и что сотрудник делал сам ── */}
          {(canViewAudit || canViewShiftHeatmap) && (
            <TabsContent value="activity">
              <div className="flex flex-col gap-5">
                {canViewShiftHeatmap && (
                  <div className="mx-auto w-full max-w-[720px]">
                    <FormSection title="Смены за год">
                      {heatmap.data ? (
                        <ShiftHeatmap hours={heatmap.data.hours} today={heatmap.data.today} />
                      ) : heatmap.denied ? (
                        <p className="text-sm text-muted-foreground">
                          Смены видны с доступом к графику или к зарплате
                        </p>
                      ) : heatmap.failed ? (
                        <div
                          role="alert"
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                        >
                          Не удалось загрузить смены
                          <Button type="button" size="sm" variant="outline" onClick={loadHeatmap}>
                            <RotateCcw className="mr-2 size-3.5" />
                            Повторить
                          </Button>
                        </div>
                      ) : (
                        <div aria-busy aria-label="Загружаем смены" className="flex flex-col gap-4">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-[98px] w-full rounded-md" />
                        </div>
                      )}
                    </FormSection>
                  </div>
                )}
                {canViewAudit &&
                  (journal.activity.page ? (
                    <EntityAuditTab
                      mode="actor"
                      actorId={profile.id}
                      canView={canViewAudit}
                      initialEvents={journal.activity.page.events}
                      initialHasMore={journal.activity.page.hasMore}
                    />
                  ) : (
                    <JournalPlaceholder
                      failed={journal.activity.failed}
                      onRetry={() => loadJournal("activity")}
                    />
                  ))}
              </div>
            </TabsContent>
          )}

          {/* ── Опасная зона ────────────────────────────────── */}
          {canFire && (
            <TabsContent value="danger">
              <ProfileDangerAction
                icon={Lock}
                title="Уволить сотрудника"
                description="Сотрудник потеряет доступ к заведению. Если это последнее заведение аккаунта, связанные записи Quick Resto будут удалены, а код замка отозван. Профиль и история сохраняются."
                actionLabel="Уволить"
                onAction={() => {
                  setFireError(null);
                  setConfirmFire(true);
                }}
                disabled={isPending}
              />
            </TabsContent>
          )}
        </Tabs>
        </SaveBarScope>
      </ProfilePageFrame>

      <ConfirmDialog
        open={Boolean(docToDelete)}
        onOpenChange={(open) => {
          if (!open) setDocToDelete(null);
        }}
        title={`Удалить документ «${docToDelete?.name ?? ""}»?`}
        description="Файл удалится из карточки сотрудника. Вернуть его можно будет только повторной загрузкой."
        confirmLabel="Удалить документ"
        pendingLabel="Удаляем…"
        destructive
        busy={deletingDoc}
        onConfirm={() => {
          if (docToDelete) void handleDeletePassportPhoto(docToDelete.path);
        }}
      />

      <ConfirmDialog
        open={confirmFire}
        onOpenChange={(open) => {
          setConfirmFire(open);
          if (!open) {
            setFireReason("");
            setOfficialEnd(officialEndDefault);
            setFireError(null);
          }
        }}
        title={`Уволить «${displayName}»?`}
        description="Сотрудник потеряет доступ к этому заведению. Если это последнее заведение аккаунта, удалим связанные записи Quick Resto и отзовём код замка. Профиль и история сохраняются. Повторный найм потребует нового оформления доступа."
        confirmLabel="Уволить сотрудника"
        pendingLabel="Увольняем…"
        destructive
        busy={isPending}
        confirmDisabled={
          fireReason.trim().length === 0 || (Boolean(officialTermination) && !officialEnd)
        }
        error={fireError}
        onConfirm={handleFire}
      >
        <div className="space-y-2">
          <Label htmlFor="fire_reason" className="text-[13px] font-medium">
            Причина увольнения <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="fire_reason"
            value={fireReason}
            onChange={(e) => setFireReason(e.target.value)}
            placeholder="Например: ушёл на другое место, нарушения дисциплины, окончание сезона"
            rows={3}
            className="resize-none"
            required
          />
          <p className="text-xs text-muted-foreground">
            Будет видна в списке уволенных и поможет вспомнить контекст
          </p>
        </div>
        {officialTermination ? (
          <Field
            label="Дата официального увольнения"
            required
            hint="Сотрудник оформлен официально: оклад по договору начисляется по эту дату"
          >
            {(control) => (
              <DatePicker
                {...control}
                aria-required
                value={officialEnd}
                onChange={setOfficialEnd}
                clearable={false}
                fromDate={new Date(`${officialTermination.startsOn}T00:00:00`)}
                disabled={isPending}
              />
            )}
          </Field>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title={`Восстановить «${displayName}»?`}
        description="Сотрудник вернётся в список действующих и снова получит доступ к заведению. Для него будут созданы записи в Quick Resto и выдан код замка."
        confirmLabel="Восстановить сотрудника"
        pendingLabel="Восстанавливаем…"
        busy={isPending}
        onConfirm={handleRestore}
      />

      <ConfirmDialog
        open={confirmPhotoDelete}
        onOpenChange={setConfirmPhotoDelete}
        title={`Удалить фото «${displayName}»?`}
        description="Фото пропадёт из карточки и списка сотрудников. Вернуть его можно будет только повторной загрузкой."
        confirmLabel="Удалить фото"
        pendingLabel="Удаляем…"
        destructive
        busy={deletingPhoto}
        onConfirm={() => void deleteAvatar()}
      />

      {/* Photo upload modal */}
      <Dialog
        open={photoModalOpen}
        onOpenChange={(open) => {
          setPhotoModalOpen(open);
          if (!open) setPhotoFile(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Фото сотрудника</DialogTitle>
            <DialogDescription>
              Загрузите фото в формате JPG, PNG или WebP размером до 5 МБ.
            </DialogDescription>
          </DialogHeader>

          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setPhotoFile(f);
            }}
            className="flex flex-col items-center justify-center gap-2 h-44 rounded-xl border border-dashed bg-muted/30 hover:bg-muted/60 transition-colors px-4 text-center"
          >
            {photoFile ? (
              <>
                <FileText className="w-8 h-8 text-brand" />
                <p className="text-[13px] font-medium text-foreground truncate max-w-full">
                  {photoFile.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(photoFile.size / 1024 / 1024).toFixed(2)} МБ — нажмите,
                  чтобы выбрать другой файл
                </p>
              </>
            ) : (
              <>
                <Upload className="w-7 h-7 text-muted-foreground/60" />
                <p className="text-[13px] text-muted-foreground">
                  Перетащите файл сюда или нажмите для выбора
                </p>
                <p className="text-xs text-muted-foreground/70">
                  JPG, PNG, WebP до 5 МБ
                </p>
              </>
            )}
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPhotoFile(f);
              e.target.value = "";
            }}
          />

          <DialogFooter>
            {avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive sm:mr-auto"
                onClick={() => {
                  setPhotoModalOpen(false);
                  setPhotoFile(null);
                  setConfirmPhotoDelete(true);
                }}
                disabled={uploadingAvatar}
              >
                <Trash2 className="w-4 h-4" />
                Удалить фото
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setPhotoModalOpen(false)}
              disabled={uploadingAvatar}
            >
              Отмена
            </Button>
            <Button
              onClick={submitAvatarModal}
              disabled={!photoFile || uploadingAvatar}
            >
              {uploadingAvatar && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              Загрузить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document upload modal */}
      <Dialog
        open={docModalOpen}
        onOpenChange={(open) => {
          setDocModalOpen(open);
          if (!open) {
            setDocName("");
            setDocFile(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить документ</DialogTitle>
            <DialogDescription>
              Укажите название и выберите файл.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-name" className="text-[13px] font-medium">
                Название
              </Label>
              <Input
                id="doc-name"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="Паспорт · Разворот 1"
                autoFocus
              />
            </div>

            <button
              type="button"
              onClick={() => docInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setDocFile(f);
              }}
              className="flex flex-col items-center justify-center gap-2 h-40 rounded-xl border border-dashed bg-muted/30 hover:bg-muted/60 transition-colors px-4 text-center"
            >
              {docFile ? (
                <>
                  <FileText className="w-7 h-7 text-brand" />
                  <p className="text-[13px] font-medium text-foreground truncate max-w-full">
                    {docFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(docFile.size / 1024 / 1024).toFixed(2)} МБ — нажмите,
                    чтобы выбрать другой
                  </p>
                </>
              ) : (
                <>
                  <Upload className="w-7 h-7 text-muted-foreground/60" />
                  <p className="text-[13px] text-muted-foreground">
                    Перетащите файл или нажмите для выбора
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    JPG, PNG, WebP, HEIC, PDF до 10 МБ
                  </p>
                </>
              )}
            </button>
            <input
              ref={docInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setDocFile(f);
                e.target.value = "";
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDocModalOpen(false)}
              disabled={uploadingDocs}
            >
              Отмена
            </Button>
            <Button
              onClick={submitDocModal}
              disabled={!docFile || !docName.trim() || uploadingDocs}
            >
              {uploadingDocs && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              Загрузить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

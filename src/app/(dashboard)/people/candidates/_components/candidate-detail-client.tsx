"use client";
import Link from "next/link";
import Image from "next/image";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  MoreHorizontal,
  CalendarPlus,
  UserCheck,
  Paperclip,
  Trash2,
  Phone,
  ExternalLink,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HardDeleteConfirmDialog } from "@/components/shared/hard-delete-confirm-dialog";
import {
  STATUSES,
  type CandidateDetail,
  type CandidatePermissions,
  type HiringOptions,
  type Appointment,
} from "@/lib/candidates/types";
import {
  getCandidate,
  getCandidateOptions,
  uploadCandidateFile,
  candidateLifecycle,
  getCandidateDoorCode,
} from "../actions";
import { canScheduleCandidateTrial, interviewFeedbackEntries } from "@/lib/candidates/workflow";
import { candidateError } from "@/lib/candidates/errors";
import { CandidateForm } from "./candidate-form";
import { HireDrawer } from "./hire-drawer";
import { CandidateComments } from "./candidate-comments";
import { CandidateAppointmentRow } from "./candidate-appointment-row";
import { CandidateAppointmentDetails } from "./candidate-appointment-details";
import { appointmentOutcomeLabel } from "@/lib/candidates/appointment-labels";
import { CandidateAppointmentDrawer } from "./candidate-appointment-drawer";
import { CandidateStatusCell } from "./candidate-status-cell";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { ProfileHeader } from "@/components/shared/profile-header";
import { ProfileSection } from "@/components/shared/profile-section";
import {
  dateLabel,
  safeLink,
  wallTime,
} from "./fields";
const labels: Record<string, string> = {
  full_name: "ФИО",
  phone: "Телефон",
  desired_position: "Желаемая должность",
  age: "Возраст",
  address: "Адрес",
  social: "Социальные сети",
  education: "Образование",
  experience: "Опыт",
  plans: "Планы",
  family_status: "Семейное положение",
  drivers_license: "Водительские права",
  salary_expectation: "Ожидания по зарплате",
  status: "Статус",
  responsible_id: "Ответственный",
  hired_user_id: "Сотрудник",
  hired_venue_id: "Заведение",
  hired_role_id: "Должность",
  archived_at: "Архив",
};
const events: Record<string, string> = {
  created: "Анкета добавлена",
  updated: "Анкета изменена",
  hired: "Принят на работу",
  commented: "Добавлен комментарий",
  comment_updated: "Комментарий изменён",
  comment_deleted: "Комментарий удалён",
  archived: "Анкета архивирована",
  restored: "Анкета восстановлена",
  file_added: "Добавлен файл",
};
export function CandidateDetailClient({
  initial,
  initialOptions,
  permissions,
}: {
  initial: CandidateDetail;
  initialOptions: HiringOptions;
  permissions: CandidatePermissions;
}) {
  const router = useRouter(),
    [data, setData] = useState(initial),
    [options, setOptions] = useState(initialOptions),
    [editing, setEditing] = useState(false),
    [hiring, setHiring] = useState(false),
    [viewing, setViewing] = useState<Appointment | null>(null),
    [meeting, setMeeting] = useState<Appointment | null | undefined>(undefined),
    [meetingKind, setMeetingKind] = useState<Appointment["kind"]>("interview"),
    [activeTab, setActiveTab] = useState("profile"),
    [deleting, setDeleting] = useState(false),
    [busy, start] = useTransition(),
    [door, setDoor] = useState<{
      user_number: number;
      password: string;
    } | null>(null);
  const c = data.candidate,
    photo = data.files.find((file) => file.url && file.mime_type?.startsWith("image/"))?.url,
    canEdit = permissions.manage && !c.archived_at;
  const refresh = async () => {
    const [next, ctx] = await Promise.all([
      getCandidate(c.id),
      getCandidateOptions(),
    ]);
    setData(next);
    setOptions(ctx);
    return next;
  };
  const action = (run: () => Promise<unknown>, message?: string) =>
    start(async () => {
      try {
        await run();
        await refresh();
        if (message) toast.success(message);
      } catch (e) {
        toast.error(candidateError(e, "Не удалось сохранить изменения"));
      }
    });
  const display = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === "")
      return "Не указано";
    if (field === "status")
      return value === "unknown"
        ? "Не указан в прежней анкете"
        : (STATUSES[value as keyof typeof STATUSES] ?? String(value));
    if (field === "responsible_id")
      return options.members.find((m) => m.id === value)?.name ?? "Сотрудник";
    if (field === "hired_venue_id")
      return options.venues.find((v) => v.id === value)?.name ?? "Заведение";
    if (field === "hired_role_id")
      return options.roles.find((r) => r.id === value)?.name ?? "Должность";
    if (field === "hired_user_id") return "Создана карточка сотрудника";
    if (field === "social" && typeof value === "object")
      return Object.values(value).join(", ");
    if (field === "archived_at") return dateLabel(String(value));
    return String(value);
  };
  const canTrial = canScheduleCandidateTrial(data.appointments, c.status);
  const latestInterview = data.appointments.find((appointment) => appointment.kind === "interview");
  const openMeeting = (kind: Appointment["kind"], appointment: Appointment | null = null) => {
    setMeetingKind(kind);
    setMeeting(appointment ?? (kind === "interview" ? latestInterview ?? null : null));
  };
  const ageForm = c.age === null ? null : new Intl.PluralRules("ru").select(c.age);
  const ageLabel = c.age === null ? null : `${c.age} ${ageForm === "one" ? "год" : ageForm === "few" ? "года" : "лет"}`;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageBreadcrumb>
        <nav aria-label="Навигация по разделам" className="flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">Люди</span>
          <span aria-hidden="true" className="text-muted-foreground">/</span>
          <Link href="/people/candidates" className="shrink-0 text-muted-foreground hover:text-foreground">Кандидаты</Link>
          <span aria-hidden="true" className="text-muted-foreground">/</span>
          <span aria-current="page" className="min-w-0 truncate" title={c.full_name}>{c.full_name}</span>
        </nav>
      </PageBreadcrumb>
      <div className="mx-auto flex w-full min-w-0 max-w-[1120px] flex-col gap-6 px-6 pb-8 pt-4 md:px-8">
        <ProfileHeader name={c.full_name} avatarUrl={photo} wrapName actions={
          <>
            {canEdit && !c.hired_user_id && !data.hire && ["new", "review", "interview"].includes(c.status) && (
              canTrial ? <Button onClick={() => openMeeting("trial")}><CalendarPlus className="mr-2 size-4" />Назначить стажировку</Button>
                : latestInterview ? <Button onClick={() => setViewing(latestInterview)}>Открыть собеседование</Button>
                  : <Button onClick={() => openMeeting("interview")}><CalendarPlus className="mr-2 size-4" />Назначить собеседование</Button>
            )}
            {c.hired_user_id ? (
              <Button asChild>
                <Link href={`/people/staff/${c.hired_user_id}`}>
                  Открыть сотрудника
                </Link>
              </Button>
            ) : permissions.hire && options.venues.some(v => v.can_hire) && !c.archived_at && (c.status === "trial" || data.hire?.state === "reserved") ? (
              <Button
                disabled={c.status !== "trial" && data.hire?.state !== "reserved"}
                title={c.status !== "trial" ? "Приём на работу доступен на этапе «Стажировка»" : undefined}
                onClick={() => setHiring(true)}
              >
                <UserCheck className="mr-2 h-4 w-4" />
                {data.hire?.state === "reserved"
                  ? "Продолжить оформление"
                  : "Принять на работу"}
              </Button>
            ) : null}
            {canEdit || permissions.owner ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Действия с кандидатом" disabled={busy}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {canEdit ? (
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <Pencil className="size-4" />
                      Редактировать
                    </DropdownMenuItem>
                  ) : null}
                  {canEdit && permissions.owner ? <DropdownMenuSeparator /> : null}
                  {permissions.owner ? (
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(true)}>
                      <Trash2 className="size-4" />
                      Удалить навсегда
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }>
          <span className="text-sm text-muted-foreground">
            {c.desired_position ?? "Желаемая должность не указана"}
          </span>
          <CandidateStatusCell
            candidate={c}
            options={options}
            disabled={!canEdit || busy}
            onSaved={(saved) => {
              setData((current) => ({ ...current, candidate: { ...current.candidate, ...saved } }));
              void refresh();
            }}
            onRefresh={() => void refresh()}
          />
          {c.archived_at && <span className="text-xs text-muted-foreground">В архиве</span>}
        </ProfileHeader>
        {data.related.length ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Есть другие анкеты с этим телефоном</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {data.related.map((r) => (
                <Link
                  key={r.id}
                  className="underline underline-offset-2"
                  href={`/people/candidates/${r.id}`}
                >
                  {r.full_name} · {dateLabel(r.submitted_at)} ·{" "}
                  {STATUSES[r.status]}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
        {data.hire?.state === "reserved" ? (
          <div
            role="status"
            className="rounded-lg border bg-muted/40 p-4 text-sm"
          >
            <p className="font-medium">Оформление сотрудника начато</p>
            <p className="mt-1 text-muted-foreground">
              {data.hire.error ??
                "Подтверждённые шаги сохраняются. Для завершения используйте «Продолжить оформление»."}
            </p>
          </div>
        ) : null}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
          <div className="overflow-x-auto">
            <TabsList className="min-w-max justify-center">
              <TabsTrigger value="profile">Анкета</TabsTrigger>
              <TabsTrigger value="communication">Коммуникация</TabsTrigger>
              <TabsTrigger value="history">Журнал</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="profile" className="mx-auto w-full max-w-[720px] space-y-5">
            <ProfileSection title="Личные данные и контакты">
              <dl className="grid min-w-0 gap-x-8 gap-y-5 sm:grid-cols-2">
                <ProfileValue label="Телефон">
                  {c.phone ? (
                  <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`} className="inline-flex max-w-full items-center gap-2 text-brand">
                    <Phone className="size-3.5 shrink-0" />
                    {c.phone}
                  </a>
                ) : null}
                </ProfileValue>
                <ProfileValue label="Возраст">{ageLabel}</ProfileValue>
                <ProfileValue label="Дата заявки">{dateLabel(c.submitted_at)}</ProfileValue>
              <ProfileValue label="Адрес">{c.address}</ProfileValue>
                {Object.entries(c.social).filter(([, value]) => value).map(([key, value]) => (
                  <ProfileValue key={key} label={key === "vk" ? "VK" : key === "telegram" ? "Telegram" : "Instagram"}>
                    {safeLink(value) ? (
                      <a href={safeLink(value)!} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-brand">
                        {value}
                        <ExternalLink className="size-3.5 shrink-0" />
                      </a>
                    ) : value}
                  </ProfileValue>
                ))}
                <ProfileValue label="Семейное положение">{c.family_status}</ProfileValue>
                <ProfileValue label="Водительские права">{c.drivers_license}</ProfileValue>
              </dl>
            </ProfileSection>
            <ProfileSection title="Опыт и пожелания">
              <dl className="space-y-5">
                <ProfileValue label="Опыт работы" wide>{c.experience}</ProfileValue>
                <ProfileValue label="Образование" wide>{c.education}</ProfileValue>
                <ProfileValue label="Ожидания по зарплате" wide>{c.salary_expectation}</ProfileValue>
                <ProfileValue label="Планы" wide>{c.plans}</ProfileValue>
              </dl>
            </ProfileSection>
            <ProfileSection title="Фотографии и файлы" actions={canEdit ? (
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-brand">
                <Paperclip className="h-4 w-4" />
                Добавить
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const form = new FormData();
                      form.set("file", file);
                      action(
                        () => uploadCandidateFile(c.id, form),
                        "Файл добавлен",
                      );
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            ) : null}>
              {data.files.length ? (
                <div className="flex flex-wrap gap-4">
                  {data.files.map((f) => (
                    <div key={f.id} className="w-36 min-w-0">
                      {f.url && f.mime_type?.startsWith("image/") ? (
                        <a href={f.url} target="_blank" rel="noreferrer">
                          <Image
                            unoptimized
                            width={144}
                            height={160}
                            alt={f.name}
                            src={f.url}
                            className="h-40 w-36 rounded-lg border object-cover"
                          />
                        </a>
                      ) : f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-28 items-center justify-center rounded-lg border bg-muted/30 text-sm text-brand"
                        >
                          Открыть PDF
                        </a>
                      ) : (
                        <div className="flex h-28 items-center justify-center rounded-lg border bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                          {f.state === "external"
                            ? "Папка с фотографиями в Google Drive"
                            : f.state === "missing"
                              ? "Исходный файл недоступен"
                              : f.state === "error"
                                ? "Не удалось перенести файл"
                                : "Переносим файл…"}
                        </div>
                      )}
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {f.name}
                      </p>
                      {!f.url && f.original_url && safeLink(f.original_url) ? (
                        <a
                          href={safeLink(f.original_url)!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand"
                        >
                          Открыть источник
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Файлов пока нет.</p>
              )}
            </ProfileSection>
            {c.hired_user_id && permissions.owner ? (
              <div className="space-y-3 border-t pt-5">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      setDoor(await getCandidateDoorCode(c.hired_user_id!));
                    })
                  }
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  Показать данные офисного замка
                </Button>
                {door ? (
                  <div className="flex items-center gap-4 rounded-lg bg-muted/40 p-4 text-sm">
                    <p>
                      Пользователь: <strong>{door.user_number}</strong> · Код:{" "}
                      <strong>{door.password}</strong>
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDoor(null)}
                    >
                      Скрыть
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <CandidateComments candidateId={c.id} comments={data.comments} viewerId={data.viewer_id} editable={canEdit} onSaved={async () => { await refresh(); }} />
          </TabsContent>
          <TabsContent value="communication" className="mx-auto w-full max-w-[720px]">
            <div className="space-y-5">
              <ProfileSection title="Собеседование">
                  {latestInterview ? <CandidateAppointmentRow appointment={latestInterview} options={options} onOpen={() => setViewing(latestInterview)} />
                    : <p className="py-6 text-sm text-muted-foreground">Собеседование ещё не назначено.</p>}
              </ProfileSection>
              <ProfileSection title="Стажировки">
                  {canEdit && canTrial && !c.hired_user_id && !data.hire && c.status === "trial" && <div className="flex justify-end pt-3"><Button variant="ghost" size="sm" className="text-brand" onClick={() => openMeeting("trial")}><CalendarPlus className="mr-1.5 size-4" />Добавить стажировку</Button></div>}
                  {data.appointments.some((a) => a.kind === "trial") ? data.appointments.filter((a) => a.kind === "trial").map((a) => <CandidateAppointmentRow key={a.id} appointment={a} options={options} onOpen={() => setViewing(a)} />)
                    : <p className="py-6 text-sm text-muted-foreground">{canTrial ? "Стажировки ещё не назначены." : "Стажировки станут доступны после результата собеседования «Пройдено» с комментарием."}</p>}
              </ProfileSection>
            </div>
          </TabsContent>
          <TabsContent value="history" className="mx-auto w-full max-w-[720px]">
            <ProfileSection title="Журнал" description="История изменений анкеты">
              <ol className="space-y-5">
                {data.events.map((item) => (
                  <li key={item.id} className="border-l-2 pl-4">
                    <p className="text-sm font-medium">
                      {item.kind.startsWith("appointment_")
                        ? (item.details.after as Partial<Appointment> | undefined)?.kind === "trial"
                          ? item.kind === "appointment_created" ? "Назначена стажировка" : "Стажировка изменена"
                          : item.kind === "appointment_created" ? "Назначено собеседование" : "Собеседование изменено"
                        : events[item.kind] ?? "Событие"}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {item.actor_name}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString("ru-RU", {
                        timeZone: "Europe/Moscow",
                      })}
                    </p>
                    {item.kind === "comment_updated" && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground"><span className="line-through">{String(item.details.before ?? "")}</span> → {String(item.details.after ?? "")}</p>}
                    {item.details.changes &&
                      typeof item.details.changes === "object" ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {Object.entries(item.details.changes).map(
                          ([field, change]) => {
                            const v = change as { old: unknown; new: unknown };
                            return (
                              <li key={field}>
                                {labels[field] ?? field}: {display(field, v.old)} →{" "}
                                {display(field, v.new)}
                              </li>
                            );
                          },
                        )}
                      </ul>
                    ) : null}
                    {item.kind.startsWith("appointment_") ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {(() => {
                          const before = item.details.before as
                            | Partial<Appointment>
                            | null
                            | undefined;
                          const after = item.details.after as
                            | Partial<Appointment>
                            | undefined;
                          const summary = (a: Partial<Appointment>) => {
                            const date =
                              a.appointment_date?.split("-").reverse().join(".") ??
                              "";
                            const time = a.starts_at
                              ? wallTime(
                                a.starts_at,
                                a.timezone ?? "Europe/Moscow",
                              ).slice(11)
                              : "";
                            return [
                              a.kind === "trial" ? "Стажировка" : "Собеседование",
                              `${date}${time ? `, ${time} (${a.timezone ?? "Europe/Moscow"})` : ""}`,
                              a.outcome ? appointmentOutcomeLabel(a.kind === "trial" ? "trial" : "interview", a.outcome) : "",
                              a.location,
                              ...interviewFeedbackEntries(a.interview_feedback).map(([label, value]) => `${label}: ${value}`),
                              a.notes,
                            ]
                              .filter(Boolean)
                              .join(" · ");
                          };
                          return after
                            ? `${before?.id ? `${summary(before)} → ` : ""}${summary(after)}`
                            : "";
                        })()}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
              {data.events.length >= 200 ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Показаны последние 200 событий.
                </p>
              ) : null}
            </ProfileSection>
          </TabsContent>
        </Tabs>

      </div>
      <HardDeleteConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        entityGenitive="анкету"
        entityName={c.full_name}
        impact={[
          {
            label: "Комментарии",
            count: data.comments.length,
            tone: "cascade",
          },
          {
            label: "Собеседования",
            count: data.appointments.filter((a) => a.kind === "interview").length,
            tone: "cascade",
          },
          { label: "Стажировки", count: data.appointments.filter((a) => a.kind === "trial").length, tone: "cascade" },
          { label: "Файлы", count: data.files.length, tone: "cascade" },
        ]}
        restrictedBy={
          c.hired_user_id
            ? [{ label: "Анкета связана с сотрудником", count: 1 }]
            : data.hire
              ? [{ label: "Начато оформление сотрудника", count: 1 }]
              : []
        }
        onConfirm={async () => {
          try {
            await candidateLifecycle(c.id, "delete");
            toast.success("Анкета удалена");
            router.push("/people/candidates");
            return { error: null };
          } catch (e) {
            return {
              error: e instanceof Error ? e.message : "Ошибка удаления",
            };
          }
        }}
      />
      {editing ? (
        <CandidateForm
          candidate={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            void refresh();
          }}
        />
      ) : null}
      {hiring ? (
        <HireDrawer
          detail={data}
          options={options}
          onClose={() => setHiring(false)}
          onSaved={(userId) => {
            if (userId) router.push(`/people/staff/${userId}`);
            else void refresh();
          }}
        />
      ) : null}
      {viewing && meeting === undefined && <CandidateAppointmentDetails key={viewing.id} candidateId={c.id} appointment={viewing} candidateName={c.full_name} options={options} editable={canEdit}
        onClose={() => setViewing(null)}
        onSchedule={() => openMeeting(viewing.kind, viewing)}
        onSaved={async () => { const next = await refresh(); setViewing(next.appointments.find((a) => a.id === viewing.id) ?? null); }} />}
      {meeting !== undefined ? (
        <CandidateAppointmentDrawer
          candidateId={c.id}
          appointment={meeting}
          initialKind={meetingKind}
          canScheduleTrial={canTrial}
          options={options}
          onClose={() => setMeeting(undefined)}
          onSaved={async () => {
            const next = await refresh();
            setViewing((current) => current ? next.appointments.find((a) => a.id === current.id) ?? null : null);
            setMeeting(undefined);
          }}
        />
      ) : null}
    </div>
  );
}
function ProfileValue({ label, children, wide = false }: { label: string; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "grid min-w-0 gap-1.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-5" : "min-w-0 space-y-1.5"}>
      <dt className="text-[13px] leading-snug text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed">{children || <span className="text-muted-foreground">Не указано</span>}</dd>
    </div>
  );
}

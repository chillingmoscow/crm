"use client";
import Link from "next/link";
import Image from "next/image";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  UserCheck,
  Plus,
  Paperclip,
  Trash2,
  Send,
  Phone,
  ExternalLink,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditDrawer } from "@/components/ui/edit-drawer";
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
  commentCandidate,
  saveCandidateAppointment,
  uploadCandidateFile,
  candidateLifecycle,
  getCandidateDoorCode,
} from "../actions";
import { candidateError } from "@/lib/candidates/errors";
import { CandidateForm } from "./candidate-form";
import { HireDrawer } from "./hire-drawer";
import { CandidateStatusCell } from "./candidate-status-cell";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { ProfileHeader } from "@/components/shared/profile-header";
import { ProfileSection } from "@/components/shared/profile-section";
import {
  Field,
  FieldSelect,
  dateLabel,
  safeLink,
  localTimeToISO,
  wallTime,
} from "./fields";
const outcomes = {
  scheduled: "Назначено",
  passed: "Пройдено",
  no_show: "Не пришёл",
  rejected: "Не подошёл",
  canceled: "Отменено",
};
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
  appointment_created: "Назначена встреча",
  appointment_updated: "Встреча изменена",
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
    [meeting, setMeeting] = useState<Appointment | null | undefined>(undefined),
    [comment, setComment] = useState(""),
    [commentKey, setCommentKey] = useState(() => crypto.randomUUID()),
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
            {canEdit ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Редактировать
              </Button>
            ) : null}
            {c.hired_user_id ? (
              <Button asChild>
                <Link href={`/people/staff/${c.hired_user_id}`}>
                  Открыть сотрудника
                </Link>
              </Button>
            ) : permissions.hire && options.venues.some(v => v.can_hire) && !c.archived_at ? (
              <Button onClick={() => setHiring(true)}>
                <UserCheck className="mr-2 h-4 w-4" />
                {data.hire?.state === "reserved"
                  ? "Продолжить оформление"
                  : "Принять на работу"}
              </Button>
            ) : null}
          </>
        }>
          <span className="text-sm text-muted-foreground">
            {c.desired_position ?? "Желаемая должность не указана"} · Анкета от {dateLabel(c.submitted_at)}
          </span>
          <CandidateStatusCell
            candidate={c}
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
        <Tabs defaultValue="profile" className="min-w-0">
          <div className="overflow-x-auto">
            <TabsList className="min-w-max justify-center">
              <TabsTrigger value="profile">Анкета</TabsTrigger>
              <TabsTrigger value="meetings">Собеседования</TabsTrigger>
              <TabsTrigger value="comments">
                Комментарии <span className="ml-1.5 rounded bg-muted px-1.5 text-xs tabular-nums">{data.comments.length}</span>
              </TabsTrigger>
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
            {c.source_url && safeLink(c.source_url) ? (
              <a
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-brand"
                href={safeLink(c.source_url)!}
                target="_blank"
                rel="noreferrer"
              >
                Исходная анкета в Notion
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
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
          </TabsContent>
          <TabsContent value="meetings" className="mx-auto w-full max-w-[720px]">
            <ProfileSection title="Собеседования и стажировки" description="Даты, участники и результаты встреч">
              {canEdit ? (
                <Button variant="outline" onClick={() => setMeeting(null)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Назначить встречу
                </Button>
              ) : null}
              {data.appointments.length ? (
                data.appointments.map((a) => (
                  <article
                    key={a.id}
                    className="flex flex-wrap items-start justify-between gap-3 border-b py-4"
                  >
                    <div>
                      <p className="font-medium">
                        {a.kind === "interview" ? "Собеседование" : "Стажировка"} ·{" "}
                        {a.starts_at
                          ? new Date(a.starts_at).toLocaleString("ru-RU", {
                            timeZone: a.timezone,
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                          : a.appointment_date.split("-").reverse().join(".")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {a.timezone} · {outcomes[a.outcome]}
                        {a.location ? ` · ${a.location}` : ""}
                        {a.interviewer_id
                          ? ` · ${options.members.find((m) => m.id === a.interviewer_id)?.name ?? "Интервьюер"}`
                          : ""}
                      </p>
                      {a.notes ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm">
                          {a.notes}
                        </p>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMeeting(a)}
                      >
                        Изменить
                      </Button>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="py-8 text-sm text-muted-foreground">
                  Собеседования и стажировки ещё не назначены.
                </p>
              )}
            </ProfileSection>
          </TabsContent>
          <TabsContent value="comments" className="mx-auto w-full max-w-[720px]">
            <ProfileSection title="Комментарии" description="Обсуждение анкеты и заметки по общению">
              {canEdit ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action(async () => {
                      await commentCandidate(c.id, comment, commentKey);
                      setComment("");
                      setCommentKey(crypto.randomUUID());
                    });
                  }}
                >
                  <Textarea
                    aria-label="Комментарий"
                    placeholder="Добавить комментарий…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={12000}
                  />
                  <Button type="submit" disabled={busy || !comment.trim()}>
                    <Send className="mr-2 h-4 w-4" />
                    Отправить
                  </Button>
                </form>
              ) : null}
              {data.comments.map((item) => (
                <article key={item.id} className="border-b pb-5">
                  <div className="flex flex-wrap items-center gap-x-3 text-xs">
                    <strong className="font-medium">{item.author_name}</strong>
                    <span className="text-muted-foreground">
                      {new Date(item.created_at).toLocaleString("ru-RU", {
                        timeZone: "Europe/Moscow",
                      })}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                    {item.body}
                  </p>
                </article>
              ))}
              {!data.comments.length ? (
                <p className="text-sm text-muted-foreground">
                  Комментариев пока нет.
                </p>
              ) : null}
            </ProfileSection>
          </TabsContent>
          <TabsContent value="history" className="mx-auto w-full max-w-[720px]">
            <ProfileSection title="Журнал" description="История изменений анкеты">
              <ol className="space-y-5">
                {data.events.map((item) => (
                  <li key={item.id} className="border-l-2 pl-4">
                    <p className="text-sm font-medium">
                      {events[item.kind] ?? "Событие"}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {item.actor_name}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString("ru-RU", {
                        timeZone: "Europe/Moscow",
                      })}
                    </p>
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
                              a.outcome ? outcomes[a.outcome] : "",
                              a.location,
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
        {permissions.owner ? (
          <div className="mx-auto flex w-full max-w-[720px] flex-wrap gap-2 border-t pt-5">
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Удалить навсегда
            </Button>
          </div>
        ) : null}
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
            label: "Встречи",
            count: data.appointments.length,
            tone: "cascade",
          },
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
      {meeting !== undefined ? (
        <AppointmentForm
          candidateId={c.id}
          appointment={meeting}
          options={options}
          onClose={() => setMeeting(undefined)}
          onSaved={() => {
            void refresh();
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
function AppointmentForm({
  candidateId,
  appointment: a,
  options,
  onClose,
  onSaved,
}: {
  candidateId: string;
  appointment: Appointment | null;
  options: HiringOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState(a?.kind ?? "interview"),
    [date, setDate] = useState(a?.appointment_date ?? ""),
    [time, setTime] = useState(
      a?.starts_at ? wallTime(a.starts_at, a.timezone).slice(11) : "",
    ),
    [timezone, setTimezone] = useState(a?.timezone ?? "Europe/Moscow"),
    [location, setLocation] = useState(a?.location ?? ""),
    [interviewer, setInterviewer] = useState(a?.interviewer_id ?? ""),
    [outcome, setOutcome] = useState(a?.outcome ?? "scheduled"),
    [notes, setNotes] = useState(a?.notes ?? ""),
    [busy, start] = useTransition();
  const save = () =>
    start(async () => {
      try {
        await saveCandidateAppointment(candidateId, {
          ...(a ? { id: a.id, revision: a.revision } : {}),
          kind,
          appointment_date: date,
          starts_at: time ? localTimeToISO(`${date}T${time}`, timezone) : null,
          timezone,
          location,
          interviewer_id: interviewer || null,
          outcome,
          notes,
        });
        toast.success("Встреча сохранена");
        onSaved();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Не удалось сохранить встречу",
        );
      }
    });
  return (
    <EditDrawer
      open
      title={a ? "Изменить встречу" : "Назначить встречу"}
      description="Дата, место, интервьюер и результат встречи"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy || !date} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <FieldSelect
        label="Тип встречи"
        disabled={!!a}
        value={kind}
        onChange={(v) => setKind(v as typeof kind)}
        options={[
          { value: "interview", label: "Собеседование" },
          { value: "trial", label: "Стажировка" },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Дата *">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Время · необязательно">
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
      <FieldSelect
        label="Часовой пояс"
        value={timezone}
        onChange={setTimezone}
        options={[
          ...new Set([
            "Europe/Moscow",
            ...options.venues.map((v) => v.timezone),
            timezone,
          ]),
        ].map((v) => ({ value: v, label: v }))}
      />
      <Field label="Место или ссылка на звонок">
        <Input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <FieldSelect
        label="Интервьюер"
        value={interviewer}
        onChange={setInterviewer}
        options={[
          { value: "", label: "Не назначен" },
          ...options.members.map((m) => ({ value: m.id, label: m.name })),
        ]}
      />
      <FieldSelect
        label="Результат"
        value={outcome}
        onChange={(v) => setOutcome(v as typeof outcome)}
        options={Object.entries(outcomes).map(([value, label]) => ({
          value,
          label,
        }))}
      />
      <Field label="Заметки">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={12000}
        />
      </Field>
    </EditDrawer>
  );
}

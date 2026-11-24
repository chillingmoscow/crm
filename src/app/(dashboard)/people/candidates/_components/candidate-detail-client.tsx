"use client";
import Link from "next/link";
import Image from "next/image";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  MoreHorizontal,
  CalendarPlus,
  UserCheck,
  Trash2,
  Phone,
  ExternalLink,
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
import { Tabs, ProfileTabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CandidateDeleteDialog } from "./candidate-delete-dialog";
import { formatPhoneDisplay, normalizePhone } from "@/lib/format/phone";
import {
  STATUSES,
  type CandidateDetail,
  type CandidatePermissions,
  type HiringOptions,
  type Appointment,
  type CandidateFile,
} from "@/lib/candidates/types";
import {
  getCandidate,
  getCandidateOptions,
  uploadCandidateFile,
  retryCandidateFile,
  removeCandidateFile,
  deleteCandidate,
} from "../actions";
import { canScheduleCandidateTrial } from "@/lib/candidates/workflow";
import { candidateFileProblem } from "@/lib/candidates/file-state";
import { candidateError } from "@/lib/candidates/errors";
import { CandidateForm } from "./candidate-form";
import { HireDrawer } from "./hire-drawer";
import { StaffDoorCode } from "@/components/people/staff-door-code";
import { CandidateComments } from "./candidate-comments";
import { CandidateAppointmentRow } from "./candidate-appointment-row";
import { CandidateAppointmentDetails } from "./candidate-appointment-details";
import { CandidateAppointmentDrawer } from "./candidate-appointment-drawer";
import { CandidateStatusCell } from "./candidate-status-cell";
import { CandidateTimeline } from "./candidate-timeline";
import { ProfileHeader } from "@/components/shared/profile-header";
import { ProfileSection, ProfileSectionAddButton } from "@/components/shared/profile-section";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import { dateLabel, safeLink } from "./fields";
import { socialLink } from "@/lib/candidates/social-link";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { unwrapAction } from "@/lib/actions/result";
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
    [removingFile, setRemovingFile] = useState<CandidateFile | null>(null),
    [removeError, setRemoveError] = useState<string | null>(null),
    [busy, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const c = data.candidate,
    photo = data.files.find((file) => file.url && file.mime_type?.startsWith("image/"))?.url,
    canEdit = permissions.manage;
  const refresh = async () => {
    const [next, ctx] = await Promise.all([
      getCandidate(c.id).then(unwrapAction),
      getCandidateOptions().then(unwrapAction),
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
      <Breadcrumbs
        items={[
          { label: "Люди" },
          { label: "Кандидаты", href: "/people/candidates" },
          { label: c.full_name },
        ]}
      />
      <ProfilePageFrame>
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
            ) : permissions.hire && options.venues.some(v => v.can_hire) && (c.status === "trial" || data.hire?.state === "reserved") ? (
              // Блок рисуется только на «Стажировке» или при начатом
              // оформлении — в обоих случаях кнопка доступна, поэтому ни
              // disabled, ни подсказки про этап здесь не нужно.
              <Button onClick={() => setHiring(true)}>
                <UserCheck />
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
          <ProfileTabsList>
            <TabsTrigger value="profile">Анкета</TabsTrigger>
            <TabsTrigger value="communication">Коммуникация</TabsTrigger>
            <TabsTrigger value="history">Журнал</TabsTrigger>
          </ProfileTabsList>
          <TabsContent value="profile" className="space-y-5">
            <ProfileSection title="Личные данные и контакты">
              <dl className="grid min-w-0 gap-x-8 gap-y-5 sm:grid-cols-2">
                <ProfileValue label="Телефон">
                  {c.phone ? (
                  <a href={`tel:${normalizePhone(c.phone) ?? c.phone.replace(/[^+\d]/g, "")}`} className="inline-flex max-w-full items-center gap-2 text-brand">
                    <Phone className="size-3.5 shrink-0" />
                    {formatPhoneDisplay(c.phone)}
                  </a>
                ) : null}
                </ProfileValue>
                <ProfileValue label="Возраст">{ageLabel}</ProfileValue>
                <ProfileValue label="Дата заявки">{dateLabel(c.submitted_at)}</ProfileValue>
              <ProfileValue label="Адрес">{c.address}</ProfileValue>
                {Object.entries(c.social).filter(([, value]) => value).map(([key, value]) => {
                  // Длинные ссылки с трекингом не показываем: только «@ник».
                  const link = socialLink(key, value);
                  return (
                    <ProfileValue key={key} label={key === "vk" ? "VK" : key === "telegram" ? "Telegram" : "Instagram"}>
                      {link.href ? (
                        <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-brand hover:underline">
                          <span className="truncate">{link.label}</span>
                          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        </a>
                      ) : link.label}
                    </ProfileValue>
                  );
                })}
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
              <>
                <ProfileSectionAddButton disabled={busy} onClick={() => fileInput.current?.click()}>
                  Добавить файл
                </ProfileSectionAddButton>
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const form = new FormData();
                      form.set("file", file);
                      action(
                        async () => unwrapAction(await uploadCandidateFile(c.id, form)),
                        "Файл добавлен",
                      );
                    }
                    e.target.value = "";
                  }}
                />
              </>
            ) : null}>
              {data.files.length ? (
                <div className="flex flex-wrap gap-4">
                  {data.files.map((f) => {
                    const problem = f.url ? null : candidateFileProblem(f);
                    const failed = f.state === "error" || f.state === "missing";
                    return (
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
                        <div
                          role={failed ? "alert" : undefined}
                          className={`flex h-28 flex-col items-center justify-center gap-1 rounded-lg border p-3 text-center text-xs ${failed ? "border-destructive/30 bg-destructive/5" : "bg-muted/30 text-muted-foreground"}`}
                        >
                          <span className={failed ? "font-medium text-destructive" : undefined}>
                            {problem?.title ?? "Переносим файл…"}
                          </span>
                          {problem?.reason ? (
                            <span className="text-muted-foreground">{problem.reason}</span>
                          ) : null}
                        </div>
                      )}
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {f.name}
                      </p>
                      {(!f.url && f.original_url && safeLink(f.original_url)) || (canEdit && (problem?.canRetry || problem?.canRemove)) ? (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {canEdit && problem?.canRetry ? (
                            <button
                              type="button"
                              className="touch-target rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                              disabled={busy}
                              onClick={() =>
                                start(async () => {
                                  try {
                                    const outcome = unwrapAction(await retryCandidateFile(c.id, f.id));
                                    await refresh();
                                    if (outcome === "ready") toast.success("Файл перенесён");
                                    else if (outcome === "missing") toast.error("Файл удалён из исходного хранилища");
                                    else toast.error("Перенести файл снова не удалось");
                                  } catch (e) {
                                    toast.error(candidateError(e, "Не удалось повторить перенос"));
                                  }
                                })
                              }
                            >
                              Повторить
                            </button>
                          ) : null}
                          {!f.url && f.original_url && safeLink(f.original_url) ? (
                            <a
                              href={safeLink(f.original_url)!}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand hover:underline"
                            >
                              Открыть источник
                            </a>
                          ) : null}
                          {canEdit && problem?.canRemove ? (
                            <button
                              type="button"
                              className="touch-target rounded-sm text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                              disabled={busy}
                              onClick={() => {
                                setRemoveError(null);
                                setRemovingFile(f);
                              }}
                            >
                              Убрать
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Файлов пока нет</p>
              )}
            </ProfileSection>
            {c.hired_user_id && permissions.owner ? (
              <ProfileSection title="Офисный замок">
                <StaffDoorCode userId={c.hired_user_id} />
              </ProfileSection>
            ) : null}
            <CandidateComments candidateId={c.id} comments={data.comments} viewerId={data.viewer_id} editable={canEdit} onSaved={async () => { await refresh(); }} />
          </TabsContent>
          <TabsContent value="communication">
            <div className="space-y-5">
              <CandidateTimeline candidate={c} events={data.stageEvents} />
              <ProfileSection title="Собеседование">
                  {latestInterview ? <CandidateAppointmentRow appointment={latestInterview} options={options} onOpen={() => setViewing(latestInterview)} />
                    : <p className="py-6 text-sm text-muted-foreground">Собеседование ещё не назначено</p>}
              </ProfileSection>
              <ProfileSection title="Стажировки" actions={canEdit && canTrial && !c.hired_user_id && !data.hire && c.status === "trial" ? (
                <ProfileSectionAddButton onClick={() => openMeeting("trial")}>Добавить стажировку</ProfileSectionAddButton>
              ) : undefined}>
                  {data.appointments.some((a) => a.kind === "trial") ? <div className="space-y-1">{data.appointments.filter((a) => a.kind === "trial").map((a) => <CandidateAppointmentRow key={a.id} appointment={a} options={options} onOpen={() => setViewing(a)} />)}</div>
                    : <p className="py-6 text-sm text-muted-foreground">{canTrial ? "Стажировки ещё не назначены" : "Стажировки станут доступны после результата собеседования «Пройдено» с комментарием."}</p>}
              </ProfileSection>
            </div>
          </TabsContent>
          <TabsContent value="history">
            <EntityAuditTab
              mode="entity"
              entityType="candidate"
              entityId={c.id}
              canView
              initialEvents={data.audit.events}
              initialHasMore={data.audit.hasMore}
            />
          </TabsContent>
        </Tabs>
      </ProfilePageFrame>
      <CandidateDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        name={c.full_name}
        restriction={
          c.hired_user_id
            ? "Анкета связана с сотрудником. Удаление недоступно."
            : data.hire
              ? "Начато оформление сотрудника. Удаление недоступно."
              : undefined
        }
        onConfirm={async () => {
          unwrapAction(await deleteCandidate(c.id));
          window.dispatchEvent(new Event("candidates:changed"));
          toast.success("Анкета удалена");
          router.push("/people/candidates");
        }}
      />
      <ConfirmDialog
        open={!!removingFile}
        onOpenChange={(open) => {
          if (!open && !busy) setRemovingFile(null);
        }}
        title="Убрать файл из анкеты?"
        description={
          removingFile
            ? `«${removingFile.name}» так и не перенесён в анкету. Запись о нём исчезнет, отметка останется в журнале. Нужный файл можно добавить заново кнопкой «Добавить файл».`
            : undefined
        }
        confirmLabel="Убрать файл"
        pendingLabel="Убираем…"
        destructive
        busy={busy}
        error={removeError}
        onConfirm={() => {
          if (!removingFile) return;
          const file = removingFile;
          start(async () => {
            try {
              unwrapAction(await removeCandidateFile(c.id, file.id));
              await refresh();
              setRemovingFile(null);
              toast.success("Файл убран");
            } catch (e) {
              setRemoveError(candidateError(e, "Не удалось убрать файл"));
            }
          });
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

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Boxes, Crown, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OptionSelect } from "@/components/ui/option-select";
import { Tabs, TabsContent, ProfileTabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { paletteText, type PaletteColor } from "@/lib/palette";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import type { AuditEvent } from "@/lib/audit/list";
import { PageHeaderActions } from "@/components/shared/page-header-actions";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { EmployeeIdentity } from "@/components/shared/employee-identity";
import type { StockRuleData } from "@/app/(dashboard)/documents/writeoffs/rule-actions";
import type { UpsellEditorData } from "@/app/(dashboard)/sales/additional/actions";
import { UpsellRulesTab } from "@/app/(dashboard)/sales/additional/upsell-rules-tab";

import { ICON_REGISTRY, iconForRole } from "../../../roles/_components/role-icons";
import { DepartmentIconPicker } from "../../_components/department-icon-picker";
import { DepartmentShortageBlock } from "./department-shortage-block";
import {
  deleteDepartment,
  getDepartmentDeleteRestriction,
  setRoleDepartment,
  updateDepartment,
  type Department,
  type DepartmentHead,
  type DepartmentRole,
} from "../../actions";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { ProfileHeader } from "@/components/shared/profile-header";
import {
  ProfileSection,
  ProfileSectionAddButton,
} from "@/components/shared/profile-section";
import { ProfileDangerAction } from "@/components/shared/profile-danger-zone";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SaveBarScope, SaveBarSection } from "@/components/shared/save-bar";

type AllRole = {
  id: string;
  name: string;
  code: string;
  icon: string | null;
  icon_color: string | null;
  venue_id: string | null;
  department_id: string | null;
};

type TabKey = "main" | "roles" | "upsell" | "history" | "danger";

const READ_ONLY_MESSAGE =
  "Менять подразделение могут те, кто управляет должностями";

/** Плитка иконки должности — как в списках «Должностей» и «Подразделений». */
function RoleTile({ role }: { role: Pick<AllRole, "code" | "icon" | "icon_color"> }) {
  const RoleIcon = iconForRole(role.code, role.icon);
  const tint = paletteText(role.icon_color as PaletteColor | null);
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted ${
        tint || "text-muted-foreground"
      }`}
    >
      <RoleIcon className="size-4" />
    </span>
  );
}

interface Props {
  department: Department;
  initialRoles: DepartmentRole[];
  initialHeads: DepartmentHead[];
  allRoles: AllRole[];
  canManage: boolean;
  canViewAudit: boolean;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
  /** Display name «Имя Ф.» для created_by / updated_by (для info popover). */
  createdByName: string | null;
  updatedByName: string | null;
  /** Правила недостачи заведения; null — нет доступа или не загрузились. */
  stockRules: StockRuleData | null;
  /** Правила допродаж подразделения; null — нет права настраивать продажи. */
  upsellEditor: UpsellEditorData | null;
  initialTab: "main" | "upsell";
}

export function DepartmentDetailPage({
  department,
  initialRoles,
  initialHeads,
  allRoles,
  canManage,
  canViewAudit,
  initialAuditEvents,
  initialAuditHasMore,
  createdByName,
  updatedByName,
  stockRules,
  upsellEditor,
  initialTab,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Обновление данных после сохранения — отдельный переход: общий
  // isPending занят и переключением прав, и откреплением должностей.
  const [refreshing, startRefresh] = useTransition();
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Почему удалить нельзя (например, на подразделение разнесены акты списания):
  // проверяется при открытии диалога, кнопка удаления при этом выключена.
  const [deleteRestriction, setDeleteRestriction] = useState<string | null>(null);
  const [checkingDelete, setCheckingDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable «Основное» state
  const [nameValue, setNameValue] = useState(department.name);
  const [commentValue, setCommentValue] = useState(department.description ?? "");
  const [iconValue, setIconValue] = useState<string | null>(department.icon);
  const [iconColorValue, setIconColorValue] = useState<string | null>(
    department.icon_color,
  );
  const [headRoleId, setHeadRoleId] = useState<string | null>(
    department.head_role_id,
  );

  const [roles, setRoles] = useState(initialRoles);
  const [heads] = useState(initialHeads);
  const [attachOpen, setAttachOpen] = useState(false);

  // Сравниваем trimmed-значения — иначе trailing space в description
  // делает форму permanently dirty: handleSave всё равно отправит
  // commentValue.trim(), сервер сохранит «нет изменений», но в UI
  // commentValue остаётся с пробелом → dirty не сбрасывается.
  const dirty =
    nameValue.trim() !== department.name ||
    commentValue.trim() !== (department.description ?? "") ||
    iconValue !== department.icon ||
    iconColorValue !== department.icon_color ||
    headRoleId !== department.head_role_id;

  // Должности этого подразделения по id
  const departmentRoleIds = useMemo(
    () => new Set(roles.map((r) => r.id)),
    [roles],
  );

  // Кандидаты для прикрепления — account-scoped роли, не входящие в подразделение.
  const attachableRoles = useMemo(
    () =>
      allRoles.filter(
        (r) => r.venue_id !== null && !departmentRoleIds.has(r.id),
      ),
    [allRoles, departmentRoleIds],
  );

  // ── Mutations ──────────────────────────────────────────────

  function resetMain() {
    setNameValue(department.name);
    setCommentValue(department.description ?? "");
    setIconValue(department.icon);
    setIconColorValue(department.icon_color);
    setHeadRoleId(department.head_role_id);
  }

  async function saveMain(): Promise<boolean> {
    const trimmedName = nameValue.trim();
    if (!trimmedName) {
      toast.error("Название не может быть пустым");
      return false;
    }
    // `head_role_id` шлём только если поменялся: триггер
    // `trg_departments_check_head_role` срабатывает на UPDATE OF
    // head_role_id ВСЕГДА, когда колонка в SET — даже если значение
    // то же. Если в БД уже неконсистентное состояние (head_role был
    // детачнут из подразделения через /people/roles flow), любой
    // save с присутствующим head_role_id отвалится. Отправляем
    // только реально dirty-поля.
    const patch: Parameters<typeof updateDepartment>[1] = {
      name: trimmedName,
      description: commentValue.trim() || null,
      icon: iconValue,
      iconColor: iconColorValue,
    };
    if (headRoleId !== department.head_role_id) {
      patch.headRoleId = headRoleId;
    }
    setSaving(true);
    try {
      const result = await updateDepartment(department.id, patch);
      if (result.error) {
        toast.error(result.error);
        return false;
      }
      toast.success("Изменения сохранены");
      // Полоса остаётся в «Сохраняем…», пока не придут свежие данные.
      startRefresh(() => router.refresh());
      return true;
    } catch {
      toast.error("Не удалось сохранить изменения. Проверьте подключение и повторите");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function detachRole(roleId: string) {
    startTransition(async () => {
      const result = await setRoleDepartment(roleId, null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      if (roleId === headRoleId) setHeadRoleId(null);
      toast.success("Должность откреплена");
      router.refresh();
    });
  }

  function attachRole(role: AllRole) {
    startTransition(async () => {
      const result = await setRoleDepartment(role.id, department.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setRoles((prev) =>
        [
          ...prev,
          {
            id: role.id,
            name: role.name,
            code: role.code,
            icon: role.icon,
            icon_color: role.icon_color,
          },
        ].sort((a, b) => a.name.localeCompare(b.name, "ru")),
      );
      toast.success(`«${role.name}» в подразделении`);
      setAttachOpen(false);
      router.refresh();
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteDepartment(department.id);
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      toast.success("Подразделение удалено");
      router.push("/people/departments");
    });
  }

  // ── Render ─────────────────────────────────────────────────

  const HeaderIcon = (iconValue && ICON_REGISTRY[iconValue]) || Boxes;
  const headerTint = paletteText(iconColorValue as PaletteColor | null);
  const readOnly = !canManage;
  const savedHeadRole = roles.find((r) => r.id === department.head_role_id);

  return (
    <div className="flex-1 flex flex-col">
      <Breadcrumbs
        items={[
          { label: "Люди" },
          { label: "Подразделения", href: "/people/departments" },
          { label: department.name },
        ]}
      />

      {/* Info popover в top bar справа от bell */}
      <PageHeaderActions>
        <EntityInfoPopover
          title="О подразделении"
          id={department.id}
          createdLabel="Создано"
          updatedLabel="Изменено"
          createdAt={department.created_at}
          createdByName={createdByName}
          updatedAt={department.updated_at}
          updatedByName={updatedByName}
        />
      </PageHeaderActions>

      <ProfilePageFrame>
        <SaveBarScope>
        <SaveBarSection
          dirty={canManage && dirty}
          saving={saving || refreshing}
          save={saveMain}
          reset={resetMain}
          blocked={
            canManage && dirty && !nameValue.trim()
              ? "Укажите название подразделения"
              : null
          }
        />
        <ProfileHeader
          name={department.name}
          wrapName
          avatar={
            <div
              aria-hidden
              className={`flex size-14 items-center justify-center rounded-[14px] bg-muted ${
                headerTint || "text-muted-foreground"
              }`}
            >
              <HeaderIcon className="size-7" />
            </div>
          }
        >
          {department.description && (
            <span className="text-sm text-muted-foreground">
              {department.description}
            </span>
          )}
        </ProfileHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <ProfileTabsList>
            <TabsTrigger value="main">Основное</TabsTrigger>
            <TabsTrigger value="roles">Должности</TabsTrigger>
            {upsellEditor && <TabsTrigger value="upsell">Допродажи</TabsTrigger>}
            {canViewAudit && (
              <TabsTrigger value="history">Журнал</TabsTrigger>
            )}
            {canManage && (
              <TabsTrigger value="danger">Опасная зона</TabsTrigger>
            )}
          </ProfileTabsList>

          {/* ── Основное ─────────────────────────────────────── */}
          {/* Смонтирована всегда: правка «Недостачи» не теряется при
              переходе на другую вкладку. Основные поля и доли сохраняет
              одна полоса внизу колонки. */}
          <TabsContent
            value="main"
            forceMount
            className="flex flex-col gap-5 data-[state=inactive]:hidden"
          >
            <ProfileSection
              title="Основное"
              locked={readOnly ? { tone: "locked", message: READ_ONLY_MESSAGE } : undefined}
            >
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canManage && dirty && !saving) void saveMain();
                }}
              >
                {/* Enter в поле сохраняет форму; видимая кнопка — в полосе. */}
                <button
                  type="submit"
                  tabIndex={-1}
                  aria-hidden
                  className="sr-only"
                />
                <div className="flex items-end gap-2">
                  <Field
                    id="dep-name"
                    label="Название"
                    required
                    className="flex-1"
                  >
                    {(control) => (
                      <Input
                        {...control}
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        disabled={readOnly}
                        placeholder="Например: Бар"
                        maxLength={120}
                      />
                    )}
                  </Field>
                  <DepartmentIconPicker
                    value={iconValue}
                    color={iconColorValue}
                    onChange={({ icon, color }) => {
                      setIconValue(icon);
                      setIconColorValue(color);
                    }}
                    disabled={readOnly}
                  />
                </div>

                <Field id="dep-desc" label="Описание">
                  {(control) => (
                    <Textarea
                      {...control}
                      value={commentValue}
                      onChange={(e) => setCommentValue(e.target.value)}
                      disabled={readOnly}
                      placeholder="Кто входит, чем занимается"
                      rows={3}
                    />
                  )}
                </Field>

                <Field
                  id="dep-head"
                  label="Руководящая должность"
                  hint={
                    roles.length === 0
                      ? "Сначала добавьте должности на вкладке «Должности»"
                      : undefined
                  }
                >
                  {(control) => (
                    <OptionSelect
                      {...control}
                      value={headRoleId ?? ""}
                      onValueChange={(v) => setHeadRoleId(v || null)}
                      disabled={readOnly || saving || roles.length === 0}
                      options={[
                        { value: "", label: "Не назначена" },
                        ...roles.map((r) => ({ value: r.id, label: r.name })),
                      ]}
                    />
                  )}
                </Field>
              </form>
            </ProfileSection>

            {/* Чтение: кто сейчас занимает руководящую должность. Считается
                по сохранённой должности, поэтому до сохранения не меняется. */}
            {savedHeadRole && (
              <ProfileSection
                title="Сейчас руководят"
                description={`Активные сотрудники на должности «${savedHeadRole.name}»`}
              >
                {heads.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Сейчас на этой должности никто не работает
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {heads.map((h) => {
                      const name =
                        [h.first_name, h.last_name].filter(Boolean).join(" ") ||
                        "Без имени";
                      return (
                        <li
                          key={`${h.venue_id}-${h.user_id}`}
                          className="flex min-w-0 items-center justify-between gap-3"
                        >
                          <Link
                            href={`/people/staff/${h.user_id}`}
                            className="min-w-0 rounded-md hover:underline"
                          >
                            <EmployeeIdentity
                              name={name}
                              role={h.role_name}
                              avatarUrl={h.avatar_url}
                            />
                          </Link>
                          <span className="shrink-0 truncate text-[13px] text-muted-foreground">
                            {h.venue_name}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ProfileSection>
            )}

            <DepartmentShortageBlock
              rules={stockRules}
              departmentId={department.id}
            />
          </TabsContent>

          {/* ── Должности ────────────────────────────────────── */}
          <TabsContent value="roles">
            <ProfileSection
              title="Должности в подразделении"
              description="Похожие должности, которые объединяет подразделение"
              actions={
                canManage ? (
                  <Popover open={attachOpen} onOpenChange={setAttachOpen}>
                    <PopoverTrigger asChild>
                      <ProfileSectionAddButton
                        disabled={isPending || attachableRoles.length === 0}
                        data-tip={
                          attachableRoles.length === 0
                            ? "Все должности заведения уже в этом подразделении"
                            : undefined
                        }
                      >
                        Добавить должность
                      </ProfileSectionAddButton>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-64 max-w-[calc(100vw-24px)] p-1"
                    >
                      <div
                        className="max-h-72 overflow-y-auto"
                        aria-label="Должности заведения"
                      >
                        {attachableRoles.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => attachRole(r)}
                            disabled={isPending}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
                          >
                            <span className="min-w-0 flex-1 truncate">{r.name}</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : undefined
              }
            >
              {roles.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  В подразделении пока нет должностей
                </p>
              ) : (
                <ul className="-mx-2 flex flex-col">
                  {roles.map((r) => {
                    const isHead = r.id === headRoleId;
                    return (
                      <li
                        key={r.id}
                        className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2"
                      >
                        <RoleTile role={r} />
                        <Link
                          href={`/people/roles/${r.id}`}
                          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                          data-tip={r.name}
                        >
                          {r.name}
                        </Link>
                        {isHead && (
                          <StatusBadge tone="warning" icon={<Crown />} className="shrink-0">
                            Руководитель
                          </StatusBadge>
                        )}
                        {canManage && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => detachRole(r.id)}
                            disabled={isPending}
                            aria-label={`Открепить должность «${r.name}»`}
                            data-tip="Открепить должность"
                          >
                            <X className="size-4" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </ProfileSection>
          </TabsContent>

          {/* ── Допродажи ────────────────────────────────────── */}
          {/* Смонтирована всегда, как «Основное»: черновик правил не теряется
              при переходе на другую вкладку и сохраняется общей полосой. */}
          {upsellEditor && (
            <TabsContent
              value="upsell"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <UpsellRulesTab initial={upsellEditor} />
            </TabsContent>
          )}

          {/* ── Журнал ──────────────────────────────────────── */}
          {canViewAudit && (
            <TabsContent value="history">
              <EntityAuditTab
                mode="entity"
                entityType="department"
                entityId={department.id}
                canView={canViewAudit}
                initialEvents={initialAuditEvents}
                initialHasMore={initialAuditHasMore}
              />
            </TabsContent>
          )}

          {/* ── Опасная зона ────────────────────────────────── */}
          {canManage && (
            <TabsContent value="danger">
              <ProfileDangerAction
                icon={Trash2}
                title="Удалить подразделение"
                description="Должности и сотрудники останутся, но должности потеряют привязку к подразделению. Архива подразделений нет. Если на подразделение разнесены акты списания, сначала перенесите их на другого плательщика."
                actionLabel="Удалить"
                onAction={() => {
                  setDeleteError(null);
                  setDeleteRestriction(null);
                  setCheckingDelete(true);
                  setConfirmDeleteOpen(true);
                  void getDepartmentDeleteRestriction(department.id)
                    .then((r) => {
                      setDeleteRestriction(r.restriction);
                      if (r.error) setDeleteError(r.error);
                    })
                    .catch(() =>
                      setDeleteError("Не удалось проверить подразделение. Попробуйте ещё раз"),
                    )
                    .finally(() => setCheckingDelete(false));
                }}
                disabled={isPending}
              />
            </TabsContent>
          )}
        </Tabs>
        </SaveBarScope>
      </ProfilePageFrame>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          setConfirmDeleteOpen(open);
          if (!open) setDeleteError(null);
        }}
        title={`Удалить подразделение «${department.name}»?`}
        description="Действие нельзя отменить. Должности останутся, но потеряют привязку к подразделению."
        confirmLabel="Удалить подразделение"
        pendingLabel="Удаляем…"
        destructive
        busy={isPending}
        confirmDisabled={checkingDelete}
        restriction={deleteRestriction}
        error={deleteError}
        onConfirm={handleDelete}
      />
    </div>
  );
}

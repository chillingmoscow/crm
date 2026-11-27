"use client";

import { useExitValue } from "@/hooks/use-exit-value";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProfileSection } from "@/components/shared/profile-section";
import { Money, formatRub } from "@/components/shared/money";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TableRowMenu, type TableRowMenuAction } from "@/components/shared/table/table-row-menu";
import { createClient } from "@/lib/supabase/client";
import { actionErrorMessage, unwrapAction, type ActionResult } from "@/lib/actions/result";
import { formatDayMonth } from "@/lib/format/date";
import { officialNet } from "@/lib/payroll/official";
import { contractLabel, officialSalaryOn } from "@/lib/people/official-employment";
import { cancelOfficialEmployment, type OfficialEmploymentData } from "../../official-actions";
import { OfficialEmploymentDrawer } from "./official-employment-drawer";
import { OfficialSalaryDrawer } from "./official-salary-drawer";
import { OfficialEndDialog } from "./official-end-dialog";
import type { OfficialDocumentTarget } from "./official-file-field";

type Panel = "employ" | "edit" | "salary" | "end" | "cancel" | null;

const TITLE = "Официальное трудоустройство";

/**
 * Блок «Официальное трудоустройство» на вкладке «Основное» карточки
 * сотрудника: оформление по договору (дата, должность, оклад, договор),
 * изменение оклада, официальное увольнение. Виден с правом просмотра
 * зарплаты, действия — с правом настройки зарплаты заведения.
 */
export function OfficialEmploymentSection({
  data,
  employeeName,
  today,
  documents,
  canAttachFiles,
}: {
  data: ActionResult<OfficialEmploymentData>;
  employeeName: string;
  /** Сегодня в часовом поясе заведения (YYYY-MM-DD). */
  today: string;
  documents: OfficialDocumentTarget;
  /** Файл договора кладётся в «Документы» — нужно право править карточку. */
  canAttachFiles: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  // Панели и окна держим смонтированными, пока они уезжают (docs/motion.md).
  const shownPanel = useExitValue(panel);
  const [contractUrl, setContractUrl] = useState<string | null>(null);
  const contractPath = data.ok ? data.data.employment?.contract_path ?? null : null;

  // Договор открывается подписанной ссылкой, как остальные «Документы».
  useEffect(() => {
    setContractUrl(null);
    if (!contractPath) return;
    let cancelled = false;
    void createClient()
      .storage.from("staff-documents")
      .createSignedUrl(contractPath, 3600)
      .then(({ data: signed }) => {
        if (!cancelled) setContractUrl(signed?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [contractPath]);

  if (!data.ok)
    return (
      <ProfileSection title={TITLE}>
        <p role="alert" className="text-sm text-destructive">
          {data.error}
        </p>
      </ProfileSection>
    );

  const { employeeId, employeeActive, employment, salaries, canEdit } = data.data;
  if (!employeeId)
    return (
      <ProfileSection title={TITLE}>
        <p className="text-sm text-muted-foreground">Сначала добавьте сотрудника в зарплату</p>
      </ProfileSection>
    );

  const canEmploy = canEdit && employeeActive && (!employment || Boolean(employment.ends_on && employment.ends_on < today));
  const close = () => setPanel(null);
  const employDrawer = shownPanel === "employ" && (
    <OfficialEmploymentDrawer
      open={panel === "employ"}
      mode="employ"
      employeeId={employeeId}
      defaultStartsOn={today}
      documents={documents}
      canAttachFiles={canAttachFiles}
      onClose={close}
    />
  );

  if (!employment)
    return (
      <ProfileSection title={TITLE}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Не оформлен официально</p>
          {canEmploy && (
            <Button type="button" variant="outline" size="sm" onClick={() => setPanel("employ")}>
              Оформить официально
            </Button>
          )}
        </div>
        {employDrawer}
      </ProfileSection>
    );

  const { current, next } = officialSalaryOn(salaries, today);
  const contract = contractLabel(employment.contract_number, employment.contract_date);
  const agency = employment.agency;
  const actions: TableRowMenuAction[] = [
    { label: agency ? "Изменить сумму в месяц" : "Изменить оклад", onSelect: () => setPanel("salary") },
    { label: "Исправить данные", onSelect: () => setPanel("edit") },
    { label: "Уволить официально", onSelect: () => setPanel("end") },
    ...(canEmploy ? [{ label: "Оформить официально", onSelect: () => setPanel("employ"), separatorBefore: true }] : []),
    { label: "Отменить оформление", onSelect: () => setPanel("cancel"), destructive: true, separatorBefore: true },
  ];

  return (
    <ProfileSection
      title={TITLE}
      actions={canEdit ? <TableRowMenu actions={actions} label="Действия с официальным оформлением" /> : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="text-sm">Оформлен с {formatDayMonth(employment.starts_on)}</p>
        {agency && <StatusBadge tone="info">Через агентство</StatusBadge>}
        {employment.ends_on && (
          <StatusBadge tone={employment.ends_on <= today ? "neutral" : "warning"}>
            {employment.ends_on <= today ? "Уволен официально" : "Увольнение"} {formatDayMonth(employment.ends_on)}
          </StatusBadge>
        )}
      </div>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(140px,220px)_1fr]">
        <div className="contents">
          <dt className="text-[13px] text-muted-foreground">Должность по договору</dt>
          <dd className="-mt-2 min-w-0 break-words text-sm sm:mt-0">{employment.position}</dd>
        </div>
        {current && (
          <div className="contents">
            <dt className="text-[13px] text-muted-foreground">{agency ? "Получает в месяц" : "Оклад"}</dt>
            <dd className="-mt-2 text-sm tabular-nums sm:mt-0">
              <Money value={current.gross} fraction="auto" />
              {!agency && (
                <>
                  {" "}· на руки <Money value={officialNet(current.gross)} fraction="auto" />
                </>
              )}
              {next && (
                <p className="text-xs text-muted-foreground">
                  С {formatDayMonth(next.valid_from)}: {formatRub(next.gross, { fraction: "auto" })}
                </p>
              )}
            </dd>
          </div>
        )}
        {(contract || employment.contract_path) && (
          <div className="contents">
            <dt className="text-[13px] text-muted-foreground">Трудовой договор</dt>
            <dd className="-mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:mt-0">
              {contract && <span className="tabular-nums">{contract}</span>}
              {contractUrl && (
                <a
                  href={contractUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                  aria-label="Открыть трудовой договор"
                >
                  Открыть
                </a>
              )}
            </dd>
          </div>
        )}
      </dl>

      {employDrawer}
      {shownPanel === "edit" && (
        <OfficialEmploymentDrawer
          open={panel === "edit"}
          mode="edit"
          employeeId={employeeId}
          employment={employment}
          defaultStartsOn={employment.starts_on}
          documents={documents}
          canAttachFiles={canAttachFiles}
          onClose={close}
        />
      )}
      {shownPanel === "salary" && (
        <OfficialSalaryDrawer
          open={panel === "salary"}
          employment={employment}
          salaries={salaries}
          today={today}
          documents={documents}
          canAttachFiles={canAttachFiles}
          onClose={close}
        />
      )}
      {shownPanel === "end" && (
        <OfficialEndDialog open={panel === "end"} employment={employment} employeeName={employeeName} today={today} onClose={close} />
      )}
      {shownPanel === "cancel" && (
        <OfficialCancelDialog
          open={panel === "cancel"}
          employmentId={employment.id}
          startsOn={employment.starts_on}
          onClose={close}
        />
      )}
    </ProfileSection>
  );
}

/** Отмена оформления, сделанного по ошибке: период пропадает из карточки и ведомости. */
function OfficialCancelDialog({
  open = true,
  employmentId,
  startsOn,
  onClose,
}: {
  /** Открыта ли панель. Её держат смонтированной, пока она уезжает (docs/motion.md). */
  open?: boolean;
  employmentId: string;
  startsOn: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      unwrapAction(await cancelOfficialEmployment(employmentId));
      toast.success("Официальное оформление отменено");
      onClose();
    } catch (e) {
      setError(actionErrorMessage(e, "Не удалось отменить оформление. Попробуйте ещё раз"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Отменить официальное оформление?"
      description={`Оформление с ${formatDayMonth(startsOn)} пропадёт из карточки и ведомости, как будто его не было. Если по нему уже есть официальные выплаты, сначала удалите их. Файл договора останется в «Документах».`}
      confirmLabel="Отменить оформление"
      pendingLabel="Отменяем…"
      destructive
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
    />
  );
}

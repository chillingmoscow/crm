import { InventoryStatusBadge } from "@/components/shared/inventory-status-badge";

/** Контент справки по разделу «Акты инвентаризации» (для кнопки «?» в топ-баре). */
export function InventoryActsHelp() {
  return (
    <>
      <Section title="Роли">
        <ul className="space-y-1.5">
          <Li>
            <b>Исполнитель</b> — заполняет фактические остатки в форме акта.
          </Li>
          <Li>
            <b>Проверяющий</b> — проверяет итоги, возвращает на пересчёт, финализирует.
          </Li>
        </ul>
      </Section>

      <Section title="Статусы акта">
        <ul className="space-y-2.5">
          <StatusLi status="synced" text="загружен из Quick Resto, исполнитель не назначен." />
          <StatusLi status="assigned" text="назначен исполнителю, заполнение ещё не начато." />
          <StatusLi status="in_progress" text="исполнитель начал заполнять (есть черновик)." />
          <StatusLi status="ready_for_review" text="заполнен и отправлен — форма закрыта, итоги ведёт проверяющий." />
          <StatusLi status="recount_pending" text="возвращён исполнителю на пересчёт: форма снова открыта, итоги заморожены, акт нельзя закрыть." />
          <StatusLi status="results_blocked" text="отправлен, но Quick Resto не вернул построчные итоги." />
          <StatusLi status="processed" text="проведён в Quick Resto (закрыт). Можно разблокировать с записью в журнал." />
          <StatusLi status="sync_error" text="сбой синхронизации с Quick Resto." />
        </ul>
      </Section>

      <Section title="Уведомления">
        <ul className="space-y-1.5">
          <Li>Назначили исполнителем / проверяющим → ему приходит уведомление.</Li>
          <Li>Исполнитель завершил акт (или пересчёт) → <b>проверяющему</b>.</Li>
          <Li>Вернули на пересчёт → <b>исполнителю</b>.</Li>
          <Li>Итоги финализированы → исполнителю.</Li>
        </ul>
      </Section>

      <p className="text-xs text-muted-foreground">
        Горячие клавиши — по клавише <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">?</kbd>.
      </p>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
      <span>{children}</span>
    </li>
  );
}

function StatusLi({ status, text }: { status: string; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <InventoryStatusBadge status={status} className="mt-0.5 shrink-0" />
      <span className="text-muted-foreground">{text}</span>
    </li>
  );
}

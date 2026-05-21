import { InventoryStatusBadge } from "@/components/shared/inventory-status-badge";

/** Контент справки по разделу «Акты инвентаризации» (для HelpButton). */
export function InventoryActsHelp({ showShortcuts = true }: { showShortcuts?: boolean }) {
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
          <Li>
            <b>Менеджер</b> — назначает исполнителя и проверяющего.
          </Li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          Исполнитель и проверяющий — разные люди: тот, кто считал, не подводит
          итоги сам (защита от подгонки).
        </p>
      </Section>

      <Section title="Статусы акта">
        <ul className="space-y-2">
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

      {showShortcuts ? (
        <Section title="Горячие клавиши (список)">
          <ul className="space-y-1.5">
            <Kbd keys="J / K" text="перейти к следующей / предыдущей строке" />
            <Kbd keys="Enter" text="открыть выделенный акт" />
            <Kbd keys="/" text="поиск" />
            <Kbd keys="F" text="показать / скрыть фильтры" />
            <Kbd keys="?" text="эта справка" />
          </ul>
        </Section>
      ) : null}
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
    <li className="flex flex-wrap items-center gap-2">
      <InventoryStatusBadge status={status} />
      <span className="text-muted-foreground">{text}</span>
    </li>
  );
}

function Kbd({ keys, text }: { keys: string; text: string }) {
  return (
    <li className="flex items-center gap-2">
      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
      <span className="text-muted-foreground">{text}</span>
    </li>
  );
}

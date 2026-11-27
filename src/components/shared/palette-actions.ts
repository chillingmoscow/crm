/**
 * Права быстрых действий палитры ⌘K. Действие ведёт на страницу раздела
 * с параметром (`?create=1` и т.п.), поэтому должно проверять те же права,
 * что и сама страница: право на просмотр раздела (иначе страница уводит на
 * /dashboard) И право на создание, при котором страница открывает панель.
 * Роль может иметь право создания без права просмотра — права задаются по
 * каждому коду отдельно.
 *
 * Меняете проверку на странице — поправьте и здесь.
 */
export const PALETTE_ACTION_PERMISSIONS = {
  // schedule/page.tsx пускает любого сотрудника; панель — по shift_create.
  shift: ["schedule.shift_create"],
  // finance/transactions/page.tsx + permissions.create.
  transaction: ["finance.view_transactions", "finance.create_transaction"],
  // Раздел — по view_guests; создание — canManage из crm_guest_list
  // (manage_guests и view_guest_details, миграция 292).
  guest: ["crm.view_guests", "crm.manage_guests", "crm.view_guest_details"],
  // people/staff/page.tsx: view_staff, панель — canInvite.
  casual: ["people.view_staff", "people.invite_staff"],
  counterparty: ["finance.view_counterparties", "finance.manage_counterparties"],
  account: ["finance.view_bank_accounts", "finance.manage_bank_accounts"],
  legalEntity: ["org.view_legal_entities", "org.manage_legal_entities"],
  kbSearch: ["kb.view_pages"],
} as const satisfies Record<string, readonly string[]>;

export type PaletteAction = keyof typeof PALETTE_ACTION_PERMISSIONS;

export function paletteActionAllowed(
  action: PaletteAction,
  perms: ReadonlySet<string>,
): boolean {
  return PALETTE_ACTION_PERMISSIONS[action].every((code) => perms.has(code));
}

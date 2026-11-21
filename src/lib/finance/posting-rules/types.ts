/** Правила разнесения операций: «если все условия — заполнить статью /
 *  контрагента / заведение». Дизайн —
 *  docs/superpowers/specs/2026-11-21-finance-posting-rules-design.md. */

export type PostingRuleCondition =
  | { field: "counterparty"; op: "in" | "not_in"; ids: string[] }
  | { field: "counterparty_group"; op: "in"; ids: string[] }
  | { field: "counterparty_inn"; op: "eq"; value: string }
  | { field: "bank_account"; op: "in"; ids: string[] }
  | { field: "type"; op: "eq"; value: "income" | "expense" }
  | { field: "amount"; op: "between"; min: number | null; max: number | null }
  | {
      field: "description";
      op: "contains" | "not_contains" | "eq" | "starts_with";
      value: string;
    };

export type PostingRuleConditionField = PostingRuleCondition["field"];

export type PostingRuleActionField = "category_id" | "counterparty_id" | "venue_id";
export type PostingRuleActions = Partial<Record<PostingRuleActionField, string | null>>;

export type PostingRule = {
  id: string;
  name: string | null;
  position: number;
  enabled: boolean;
  conditions: PostingRuleCondition[];
  actions: PostingRuleActions;
};

/** Операция глазами правила: только поля, на которые смотрят условия. */
export type RuleSubject = {
  type: "income" | "expense" | "transfer";
  amount: number | null;
  bank_account_id: string | null;
  counterparty_id: string | null;
  description: string | null;
};

export type RuleContext = {
  counterparties: Map<string, { inn: string | null; group_id: string | null }>;
  categoryTypes: Map<string, "income" | "expense" | "mixed">;
  /** Архивные, удалённые или неизвестные id любых справочников. */
  inactiveIds: Set<string>;
  /** null — пользователю доступны все заведения. */
  allowedVenueIds: Set<string> | null;
};

export type RuleMatch = { value: string; ruleId: string };
export type RuleResult = Partial<Record<PostingRuleActionField, RuleMatch>>;

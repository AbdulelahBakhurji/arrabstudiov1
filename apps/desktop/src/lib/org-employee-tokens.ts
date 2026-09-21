/**
 * Per-employee AI token allowances (org admin). Stored on-device until cloud billing lands.
 */
const STORE_KEY = "arrab.org.employee.tokens.v1";

export const DEFAULT_EMPLOYEE_TOKEN_ALLOWANCE = 200_000;

export type EmployeeTokenBudget = {
  employeeId: string;
  /** Monthly token pool for this seat. */
  allowance: number;
  /** Tokens consumed this cycle (tracked locally for display). */
  used: number;
  /** Extra credits granted by admin (added on top of allowance). */
  bonus: number;
  updatedAt: string;
};

type TokenStore = {
  budgets: Record<string, EmployeeTokenBudget>;
};

function readStore(): TokenStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { budgets: {} };
    const parsed = JSON.parse(raw) as Partial<TokenStore>;
    return { budgets: parsed.budgets && typeof parsed.budgets === "object" ? parsed.budgets : {} };
  } catch {
    return { budgets: {} };
  }
}

function writeStore(store: TokenStore) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function getEmployeeTokenBudget(employeeId: string): EmployeeTokenBudget {
  const store = readStore();
  const existing = store.budgets[employeeId];
  if (existing) return existing;
  return {
    employeeId,
    allowance: DEFAULT_EMPLOYEE_TOKEN_ALLOWANCE,
    used: 0,
    bonus: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function listEmployeeTokenBudgets(): EmployeeTokenBudget[] {
  return Object.values(readStore().budgets);
}

export function ensureEmployeeTokenBudget(employeeId: string): EmployeeTokenBudget {
  const store = readStore();
  if (!store.budgets[employeeId]) {
    store.budgets[employeeId] = {
      employeeId,
      allowance: DEFAULT_EMPLOYEE_TOKEN_ALLOWANCE,
      used: 0,
      bonus: 0,
      updatedAt: new Date().toISOString(),
    };
    writeStore(store);
  }
  return store.budgets[employeeId]!;
}

/** Grant additional token credits to an employee seat. */
export function grantEmployeeTokens(employeeId: string, amount: number): EmployeeTokenBudget {
  const add = Math.max(0, Math.floor(amount));
  const store = readStore();
  const current = store.budgets[employeeId] ?? {
    employeeId,
    allowance: DEFAULT_EMPLOYEE_TOKEN_ALLOWANCE,
    used: 0,
    bonus: 0,
    updatedAt: new Date().toISOString(),
  };
  const next: EmployeeTokenBudget = {
    ...current,
    bonus: current.bonus + add,
    updatedAt: new Date().toISOString(),
  };
  store.budgets[employeeId] = next;
  writeStore(store);
  return next;
}

export function setEmployeeTokenAllowance(
  employeeId: string,
  allowance: number,
): EmployeeTokenBudget {
  const store = readStore();
  const current = store.budgets[employeeId] ?? {
    employeeId,
    allowance: DEFAULT_EMPLOYEE_TOKEN_ALLOWANCE,
    used: 0,
    bonus: 0,
    updatedAt: new Date().toISOString(),
  };
  const next: EmployeeTokenBudget = {
    ...current,
    allowance: Math.max(0, Math.floor(allowance)),
    updatedAt: new Date().toISOString(),
  };
  store.budgets[employeeId] = next;
  writeStore(store);
  return next;
}

export function employeeTokenPool(budget: EmployeeTokenBudget): number {
  return Math.max(0, budget.allowance + budget.bonus);
}

export function employeeTokensRemaining(budget: EmployeeTokenBudget): number {
  return Math.max(0, employeeTokenPool(budget) - budget.used);
}

export function formatTokenCount(n: number, locale = "en"): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toLocaleString(locale, { maximumFractionDigits: 0 })}k`;
  }
  return n.toLocaleString(locale);
}

export const TOKEN_CREDIT_PACKS = [
  { id: "boost", tokens: 50_000, label: "+50k" },
  { id: "pro", tokens: 200_000, label: "+200k" },
  { id: "power", tokens: 1_000_000, label: "+1M" },
] as const;

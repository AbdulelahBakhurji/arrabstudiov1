import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  createContext,
  type ReactNode,
} from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { PlanAudience } from "@arrab/shared";
import {
  audienceFromAccountSignals,
  ROLE_PATH,
} from "@/domains/account/roles/catalog";
import { readAccountSessionToken } from "@/core/session/account-session";
import { isGuestLocalMode, subscribeGuestMode } from "@/core/session/guest-mode";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";

const STORAGE_KEY = "arrab.studioRole";

type RoleContextValue = {
  role: PlanAudience;
  setRole: (role: PlanAudience) => void;
  basePath: string;
  href: (path?: string) => string;
  isIndividual: boolean;
  isFamily: boolean;
  isOrganization: boolean;
};

const RoleContext = createContext<RoleContextValue | null>(null);

function hasCloudSession(): boolean {
  return Boolean(readAccountSessionToken()?.trim()) && !isGuestLocalMode();
}

export function readStoredRole(): PlanAudience {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // Organization / family chrome is account-bound — never for guests.
    if (!hasCloudSession()) {
      return "individual";
    }
    if (saved === "family" || saved === "organization" || saved === "individual") {
      return saved;
    }
  } catch {
    // ignore
  }
  return "individual";
}

function persistRole(role: PlanAudience) {
  try {
    window.localStorage.setItem(STORAGE_KEY, role);
  } catch {
    // ignore
  }
}

function roleFromPath(pathname: string): PlanAudience {
  // Guests / signed-out never inherit organization from a URL hash.
  if (!hasCloudSession()) {
    return "individual";
  }
  if (pathname.includes("/organizations")) {
    return "organization";
  }
  if (pathname.includes("/individuals")) {
    const stored = readStoredRole();
    // Family shares /individuals routes but keeps family nav/gating.
    return stored === "family" ? "family" : "individual";
  }
  return readStoredRole();
}

/**
 * Business / Team / Enterprise pages require a signed-in cloud org plan.
 * Guests and personal plans stay on the individuals shell.
 */
function roleFromPlanOrPath(
  pathname: string,
  signals: {
    planId?: string | null;
    planCategory?: string | null;
    planName?: string | null;
  },
  cloudSignedIn: boolean,
): PlanAudience {
  if (!cloudSignedIn) {
    return "individual";
  }
  if (signals.planId || signals.planCategory || signals.planName) {
    return audienceFromAccountSignals(signals);
  }
  return roleFromPath(pathname);
}

function rolePathFor(role: PlanAudience): string {
  return role === "organization" ? ROLE_PATH.organization : ROLE_PATH.individual;
}

function joinRolePath(basePath: string, path: string): string {
  if (!path || path === "/") {
    return basePath;
  }
  if (path.includes("?")) {
    const [pathname, search] = path.split("?");
    const clean = (pathname || "/").startsWith("/") ? pathname || "/" : `/${pathname}`;
    return `${basePath}${clean === "/" ? "" : clean}?${search}`;
  }
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${clean}`;
}

export function RoleProvider({
  role,
  children,
}: {
  role: PlanAudience;
  children?: ReactNode;
}) {
  const [activeRole, setActiveRole] = useState<PlanAudience>(role);

  useEffect(() => {
    setActiveRole(role);
    persistRole(role);
  }, [role]);

  const setRole = useCallback((next: PlanAudience) => {
    setActiveRole(next);
    persistRole(next);
  }, []);

  const value = useMemo<RoleContextValue>(() => {
    const basePath = rolePathFor(activeRole);
    return {
      role: activeRole,
      setRole,
      basePath,
      href: (path = "") => joinRolePath(basePath, path),
      isIndividual: activeRole === "individual",
      isFamily: activeRole === "family",
      isOrganization: activeRole === "organization",
    };
  }, [activeRole, setRole]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/** Plan audience when cloud-signed-in; guests always get the individuals shell. */
export function RoleFromPath() {
  const { pathname } = useLocation();
  const { account, status, signedIn } = useSignedInAccount();
  const guestLocal = useSyncExternalStore(
    subscribeGuestMode,
    isGuestLocalMode,
    () => false,
  );
  const cloudSignedIn = signedIn && !guestLocal;
  const entitlements = status?.entitlements;
  const role = roleFromPlanOrPath(
    pathname,
    {
      planId: entitlements?.planId ?? account?.planId ?? null,
      planCategory: entitlements?.planCategory ?? account?.planCategory ?? null,
      planName: entitlements?.planName ?? account?.planName ?? null,
    },
    cloudSignedIn,
  );
  return (
    <RoleProvider role={role}>
      <Outlet />
    </RoleProvider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    const role = readStoredRole();
    const basePath = rolePathFor(role);
    return {
      role,
      setRole: () => undefined,
      basePath,
      href: (path = "") => joinRolePath(basePath, path),
      isIndividual: role === "individual",
      isFamily: role === "family",
      isOrganization: role === "organization",
    };
  }
  return ctx;
}

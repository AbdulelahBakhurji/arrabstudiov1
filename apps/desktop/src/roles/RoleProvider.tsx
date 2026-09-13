import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { PlanAudience } from "@arrab/shared";
import { ROLE_PATH } from "@/roles/catalog";
import {
  createContext,
  useCallback,
  useContext,
} from "react";

const STORAGE_KEY = "arrab.studioRole";

type RoleContextValue = {
  role: PlanAudience;
  setRole: (role: PlanAudience) => void;
  basePath: string;
  href: (path?: string) => string;
  isIndividual: boolean;
  isOrganization: boolean;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function readStoredRole(): PlanAudience {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "organization" || saved === "individual") {
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
  if (pathname.includes("/organizations")) {
    return "organization";
  }
  if (pathname.includes("/individuals")) {
    return "individual";
  }
  return readStoredRole();
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
      isOrganization: activeRole === "organization",
    };
  }, [activeRole, setRole]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/** Reads /individuals or /organizations from the URL and provides role to the whole studio shell. */
export function RoleFromPath() {
  const { pathname } = useLocation();
  const role = roleFromPath(pathname);
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
      isOrganization: role === "organization",
    };
  }
  return ctx;
}

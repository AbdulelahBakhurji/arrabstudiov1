import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { openPlansPage } from "@/core/platform/desktop";

/**
 * In-app plan catalog is retired — managing plans happens on the website only.
 * Keep this route as a redirect so old bookmarks still land correctly.
 */
export const PLAN_PATH = {
  individual: "/plans/individuals",
  family: "/plans/families",
  organization: "/plans/organizations",
} as const;

export function PlansPage() {
  useEffect(() => {
    void openPlansPage();
  }, []);

  return <Navigate to="/individuals/account?section=plan" replace />;
}

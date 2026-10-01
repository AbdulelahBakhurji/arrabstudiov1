import { HashRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useOrgSeatCapabilities } from "@/domains/organization/org-seat";
import { orgSeatCanOpen } from "@/domains/account/roles/catalog";
import { TooltipProvider } from "@/shared/ui/primitives/tooltip";
import { AuthGate } from "@/app/shell/AuthGate";
import { StudioFrame } from "@/app/shell/StudioFrame";
import { LanguageProvider } from "@/shared/i18n/LanguageProvider";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { AccountManagementPage } from "@/domains/account/pages/AccountManagementPage";
import { ActivityPage } from "@/domains/organization/pages/ActivityPage";
import { ChatPage } from "@/domains/chat/pages/ChatPage";
import { CompanionsPage } from "@/domains/companions/pages/CompanionsPage";
import { CompanionWorkPage } from "@/domains/companions/pages/CompanionWorkPage";
import { CompanionMePage } from "@/domains/companions/pages/CompanionMePage";
import { CompanionStudioPage } from "@/domains/studio/pages/CompanionStudioPage";
import { ConnectorsPage } from "@/domains/connectors/pages/ConnectorsPage";
import { EmployeeDeskPage } from "@/domains/organization/pages/EmployeeDeskPage";
import { HomePage } from "@/domains/organization/pages/HomePage";
import { IndividualHomePage } from "@/domains/companions/pages/IndividualHomePage";
import { SecondBrainPage } from "@/domains/brain/pages/SecondBrainPage";
import { SettingsPage } from "@/domains/settings/pages/SettingsPage";
import { WorkforcePage } from "@/domains/organization/pages/WorkforcePage";
import { WorkplacePage } from "@/domains/organization/pages/WorkplacePage";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";
import { isGuestLocalMode } from "@/core/session/guest-mode";
import { RoleFromPath } from "@/domains/account/roles/RoleProvider";
import { homePathForAudience, ROLE_PATH, studioModeFromAudience } from "@/domains/account/roles/catalog";
import { audienceFromAccountSignals } from "@/domains/account/roles/catalog";
import { pageFeaturesFor } from "@/features/registry";

/**
 * Individuals enter chat, with Studio, Board, Work and Me as separate destinations.
 * Workforce and Activity belong to organizations. Org Workplace is Studios only
 * (former Cowork redirects into Workplace).
 */
function individualChildRoutes() {
  return (
    <>
      <Route index element={<CompanionsPage />} />
      <Route path="studio" element={<CompanionStudioPage />} />
      <Route path="board" element={<IndividualHomePage />} />
      <Route path="brain" element={<SecondBrainPage scope="individual" />} />
      <Route path="work" element={<CompanionWorkPage />} />
      <Route path="me" element={<CompanionMePage />} />
      <Route path="companions" element={<Navigate to=".." relative="path" replace />} />
      <Route path="connectors" element={<ConnectorsPage />} />
      <Route path="account" element={<AccountManagementPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="chat" element={<Navigate to=".." relative="path" replace />} />
      <Route path="cowork" element={<Navigate to="../work" relative="path" replace />} />
      <Route path="workforce" element={<Navigate to=".." relative="path" replace />} />
      <Route path="desk/:agentId" element={<Navigate to="../.." relative="path" replace />} />
      <Route path="activity" element={<Navigate to="../board" relative="path" replace />} />
      {pageFeaturesFor("individual").map((feature) => (
        <Route key={feature.id} path={feature.path} element={<feature.Page />} />
      ))}
      {pageFeaturesFor("family")
        .filter((feature) => !feature.audiences.includes("individual"))
        .map((feature) => (
          <Route key={`family-${feature.id}`} path={feature.path} element={<feature.Page />} />
        ))}
    </>
  );
}

/** Role gate: a seat whose role lacks this page lands back on the org home. */
function RequireSeatPage({ navKey, children }: { navKey: string; children: ReactNode }) {
  const seat = useOrgSeatCapabilities();
  const seatRole = seat.employee ? seat.role : null;
  if (!orgSeatCanOpen(seatRole, navKey)) return <Navigate to=".." relative="path" replace />;
  return <>{children}</>;
}

function organizationChildRoutes() {
  return (
    <>
      <Route index element={<HomePage />} />
      <Route path="workplace" element={<WorkplacePage />} />
      <Route path="chat" element={<ChatPage />} />
      <Route path="brain" element={<SecondBrainPage scope="solo" />} />
      <Route path="cowork" element={<Navigate to="../workplace" relative="path" replace />} />
      <Route
        path="workforce"
        element={
          <RequireSeatPage navKey="workforce">
            <WorkforcePage />
          </RequireSeatPage>
        }
      />
      <Route path="desk/:agentId" element={<EmployeeDeskPage />} />
      <Route path="connectors" element={<ConnectorsPage />} />
      <Route
        path="activity"
        element={
          <RequireSeatPage navKey="activity">
            <ActivityPage />
          </RequireSeatPage>
        }
      />
      <Route path="account" element={<AccountManagementPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="studio" element={<Navigate to="../workplace" relative="path" replace />} />
      {pageFeaturesFor("organization").map((feature) => (
        <Route key={feature.id} path={feature.path} element={<feature.Page />} />
      ))}
    </>
  );
}

/** Land on individuals or orgs from the signed-in plan (free trial / paid).
 *  Business / org pages only when cloud-signed-in on a teams-category plan. */
function PlanHomeRedirect({
  individualSuffix = "",
  organizationSuffix = "",
}: {
  individualSuffix?: string;
  organizationSuffix?: string;
}) {
  const { account, status, signedIn } = useSignedInAccount();
  const cloudSignedIn = signedIn && Boolean(account) && !isGuestLocalMode();
  if (!cloudSignedIn || !account) {
    return <Navigate to={`${ROLE_PATH.individual}${individualSuffix}`} replace />;
  }
  const audience = audienceFromAccountSignals({
    planId: status?.entitlements?.planId ?? account.planId ?? null,
    planCategory: status?.entitlements?.planCategory ?? account.planCategory ?? null,
    planName: status?.entitlements?.planName ?? account.planName ?? null,
  });
  const mode = studioModeFromAudience(audience);
  const home = homePathForAudience(audience);
  const suffix = mode === "organization" ? organizationSuffix : individualSuffix;
  return <Navigate to={`${home}${suffix}`} replace />;
}

/** Org shell is cloud-signed-in Business/Team/Enterprise only — never guests. */
function RequireOrganizationShell({ children }: { children: ReactNode }) {
  const { account, status, signedIn } = useSignedInAccount();
  const cloudSignedIn = signedIn && Boolean(account) && !isGuestLocalMode();
  if (!cloudSignedIn || !account) {
    return <Navigate to={ROLE_PATH.individual} replace />;
  }
  const audience = audienceFromAccountSignals({
    planId: status?.entitlements?.planId ?? account.planId ?? null,
    planCategory: status?.entitlements?.planCategory ?? account.planCategory ?? null,
    planName: status?.entitlements?.planName ?? account.planName ?? null,
  });
  if (audience !== "organization") {
    return <Navigate to={ROLE_PATH.individual} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <TooltipProvider delayDuration={300}>
          <HashRouter>
            <Routes>
              <Route element={<RoleFromPath />}>
                <Route element={<AuthGate />}>
                  <Route element={<StudioFrame />}>
                    <Route index element={<PlanHomeRedirect />} />

                    <Route path="individuals">{individualChildRoutes()}</Route>
                    <Route
                      path="organizations"
                      element={
                        <RequireOrganizationShell>
                          <Outlet />
                        </RequireOrganizationShell>
                      }
                    >
                      {organizationChildRoutes()}
                    </Route>

                    <Route path="plans" element={<PlanHomeRedirect />} />
                    <Route
                      path="plans/individuals"
                      element={<Navigate to={ROLE_PATH.individual} replace />}
                    />
                    <Route
                      path="plans/families"
                      element={<Navigate to={`${ROLE_PATH.individual}/settings?tab=account`} replace />}
                    />
                    <Route
                      path="plans/organizations"
                      element={<Navigate to={ROLE_PATH.organization} replace />}
                    />

                    <Route
                      path="companions"
                      element={<Navigate to={ROLE_PATH.individual} replace />}
                    />
                    <Route
                      path="chat"
                      element={
                        <PlanHomeRedirect individualSuffix="" organizationSuffix="/chat" />
                      }
                    />
                    <Route
                      path="cowork"
                      element={
                        <PlanHomeRedirect
                          individualSuffix="/work"
                          organizationSuffix="/workplace"
                        />
                      }
                    />
                    <Route
                      path="workforce"
                      element={<PlanHomeRedirect organizationSuffix="/workforce" />}
                    />
                    <Route
                      path="connectors"
                      element={<PlanHomeRedirect individualSuffix="/connectors" organizationSuffix="/connectors" />}
                    />
                    <Route
                      path="activity"
                      element={
                        <PlanHomeRedirect
                          individualSuffix="/board"
                          organizationSuffix="/activity"
                        />
                      }
                    />
                    <Route
                      path="account"
                      element={
                        <PlanHomeRedirect
                          individualSuffix="/account"
                          organizationSuffix="/account"
                        />
                      }
                    />
                    <Route
                      path="settings"
                      element={
                        <PlanHomeRedirect
                          individualSuffix="/settings"
                          organizationSuffix="/settings"
                        />
                      }
                    />
                    <Route path="*" element={<PlanHomeRedirect />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </HashRouter>
        </TooltipProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

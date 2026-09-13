import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StudioFrame } from "@/components/StudioFrame";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { ActivityPage } from "@/pages/ActivityPage";
import { ChatPage } from "@/pages/ChatPage";
import { CompanionsPage } from "@/pages/CompanionsPage";
import { ConnectorsPage } from "@/pages/ConnectorsPage";
import { CoworkPage } from "@/pages/CoworkPage";
import { EmployeeDeskPage } from "@/pages/EmployeeDeskPage";
import { HomePage } from "@/pages/HomePage";
import { IndividualHomePage } from "@/pages/IndividualHomePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WorkforcePage } from "@/pages/WorkforcePage";
import { RoleFromPath, readStoredRole } from "@/roles/RoleProvider";
import { ROLE_PATH } from "@/roles/catalog";

/**
 * Individuals live in the companion studio: a board for a dashboard and a room
 * per companion. Workforce, Cowork and Activity belong to organizations.
 */
function individualChildRoutes() {
  return (
    <>
      <Route index element={<IndividualHomePage />} />
      <Route path="companions" element={<CompanionsPage />} />
      <Route path="connectors" element={<ConnectorsPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="chat" element={<Navigate to="../companions" relative="path" replace />} />
      <Route path="cowork" element={<Navigate to="../companions" relative="path" replace />} />
      <Route path="workforce" element={<Navigate to="../companions" relative="path" replace />} />
      <Route path="desk/:agentId" element={<Navigate to="../../companions" relative="path" replace />} />
      <Route path="activity" element={<Navigate to=".." relative="path" replace />} />
    </>
  );
}

function organizationChildRoutes() {
  return (
    <>
      <Route index element={<HomePage />} />
      <Route path="chat" element={<ChatPage />} />
      <Route path="cowork" element={<CoworkPage />} />
      <Route path="workforce" element={<WorkforcePage />} />
      <Route path="desk/:agentId" element={<EmployeeDeskPage />} />
      <Route path="connectors" element={<ConnectorsPage />} />
      <Route path="activity" element={<ActivityPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </>
  );
}

export function App() {
  const defaultRole = readStoredRole();
  const defaultHome =
    defaultRole === "organization" ? ROLE_PATH.organization : ROLE_PATH.individual;

  return (
    <ThemeProvider>
      <LanguageProvider>
        <TooltipProvider delayDuration={300}>
          <HashRouter>
            <Routes>
              <Route element={<RoleFromPath />}>
                <Route element={<StudioFrame />}>
                  <Route index element={<Navigate to={defaultHome} replace />} />

                  <Route path="individuals">{individualChildRoutes()}</Route>
                  <Route path="organizations">{organizationChildRoutes()}</Route>

                  <Route path="plans" element={<Navigate to={ROLE_PATH.individual} replace />} />
                  <Route
                    path="plans/individuals"
                    element={<Navigate to={ROLE_PATH.individual} replace />}
                  />
                  <Route
                    path="plans/organizations"
                    element={<Navigate to={ROLE_PATH.organization} replace />}
                  />

                  <Route
                    path="companions"
                    element={<Navigate to={`${ROLE_PATH.individual}/companions`} replace />}
                  />
                  <Route path="chat" element={<Navigate to={`${defaultHome}/chat`} replace />} />
                  <Route path="cowork" element={<Navigate to={`${defaultHome}/cowork`} replace />} />
                  <Route
                    path="workforce"
                    element={<Navigate to={`${defaultHome}/workforce`} replace />}
                  />
                  <Route
                    path="connectors"
                    element={<Navigate to={`${defaultHome}/connectors`} replace />}
                  />
                  <Route
                    path="activity"
                    element={<Navigate to={`${defaultHome}/activity`} replace />}
                  />
                  <Route
                    path="settings"
                    element={<Navigate to={`${defaultHome}/settings`} replace />}
                  />
                  <Route path="*" element={<Navigate to={defaultHome} replace />} />
                </Route>
              </Route>
            </Routes>
          </HashRouter>
        </TooltipProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

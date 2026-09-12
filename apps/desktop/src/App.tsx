import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StudioFrame } from "@/components/StudioFrame";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { ActivityPage } from "@/pages/ActivityPage";
import { ChatPage } from "@/pages/ChatPage";
import { ConnectorsPage } from "@/pages/ConnectorsPage";
import { CoworkPage } from "@/pages/CoworkPage";
import { EmployeeDeskPage } from "@/pages/EmployeeDeskPage";
import { HomePage } from "@/pages/HomePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WorkforcePage } from "@/pages/WorkforcePage";

export function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <TooltipProvider delayDuration={300}>
          <HashRouter>
            <Routes>
              <Route element={<StudioFrame />}>
                <Route index element={<HomePage />} />
                <Route path="chat" element={<ChatPage />} />
                <Route path="cowork" element={<CoworkPage />} />
                <Route path="workforce" element={<WorkforcePage />} />
                <Route path="desk/:agentId" element={<EmployeeDeskPage />} />
                <Route path="connectors" element={<ConnectorsPage />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </TooltipProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

import { Navigate } from "react-router-dom";

/**
 * Professional desk UI is chat-first (no hub pills). Backend stays at /v1/professional.
 * Org rail entry is hidden; redirect to workforce.
 */
export function ProfessionalDeskPage() {
  return <Navigate to="../workforce" relative="path" replace />;
}

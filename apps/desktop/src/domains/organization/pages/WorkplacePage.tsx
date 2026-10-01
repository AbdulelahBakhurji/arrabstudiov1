import { CompanionStudioPage } from "@/domains/studio/pages/CompanionStudioPage";

/**
 * Organization Workplace = Studios only (Cowork/Desk removed).
 * Former /cowork routes redirect here.
 */
export function WorkplacePage() {
  return <CompanionStudioPage variant="studios" />;
}

/** Public companions surface — prefer deep imports for large modules. */
export type { CompanionProfile } from "@/domains/companions/model/companions";
export {
  findCompanion,
  getCompanionState,
  liveCompanions,
  useCompanionState,
} from "@/domains/companions/model/companions";
export { CompanionsPage } from "@/domains/companions/pages/CompanionsPage";
export { IndividualHomePage } from "@/domains/companions/pages/IndividualHomePage";

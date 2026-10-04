import { Sparkles } from "lucide-react";
import type { StudioFeature } from "@/features/types";
import { ProfessionalDeskPage } from "./ProfessionalDeskPage";

export const feature: StudioFeature = {
  id: "professional-desk",
  kind: "page",
  path: "professional-desk",
  audiences: ["organization"],
  titleKey: "professionalDeskTitle",
  icon: Sparkles,
  Page: ProfessionalDeskPage,
  nav: false,
  hideForFamilyChild: false,
};

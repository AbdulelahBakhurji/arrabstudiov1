import { Laptop } from "lucide-react";
import type { StudioFeature } from "@/features/types";
import { CompanionDeskPage } from "./CompanionDeskPage";

export const feature: StudioFeature = {
  id: "companion-desk",
  kind: "page",
  path: "companion-desk",
  audiences: ["individual", "family", "organization"],
  titleKey: "companionDeskTitle",
  icon: Laptop,
  Page: CompanionDeskPage,
  nav: false,
  hideForFamilyChild: true,
};

import { BookOpen } from "lucide-react";
import type { StudioFeature } from "@/features/types";
import { SpacesPage } from "./SpacesPage";

export const feature: StudioFeature = {
  id: "spaces",
  kind: "page",
  path: "spaces",
  audiences: ["individual", "family"],
  titleKey: "spacesTitle",
  icon: BookOpen,
  Page: SpacesPage,
  nav: true,
  hideForFamilyChild: false,
};

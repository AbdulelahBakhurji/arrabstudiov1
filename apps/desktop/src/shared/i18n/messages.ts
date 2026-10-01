import { accountEn } from "./locales/en/account";
import { brainEn } from "./locales/en/brain";
import { chatEn } from "./locales/en/chat";
import { commonEn } from "./locales/en/common";
import { companionsEn } from "./locales/en/companions";
import { connectorsEn } from "./locales/en/connectors";
import { encryptionEn } from "./locales/en/encryption";
import { familyEn } from "./locales/en/family";
import { managedEn } from "./locales/en/managed";
import { organizationEn } from "./locales/en/organization";
import { settingsEn } from "./locales/en/settings";
import { studioEn } from "./locales/en/studio";
import { accountAr } from "./locales/ar/account";
import { brainAr } from "./locales/ar/brain";
import { chatAr } from "./locales/ar/chat";
import { commonAr } from "./locales/ar/common";
import { companionsAr } from "./locales/ar/companions";
import { connectorsAr } from "./locales/ar/connectors";
import { encryptionAr } from "./locales/ar/encryption";
import { familyAr } from "./locales/ar/family";
import { managedAr } from "./locales/ar/managed";
import { organizationAr } from "./locales/ar/organization";
import { settingsAr } from "./locales/ar/settings";
import { studioAr } from "./locales/ar/studio";

export type Locale = "en" | "ar";

/** Copy lives next to the domain that uses it: `locales/<lang>/<domain>.ts` (shared keys in `common`). */
export const messages = {
  en: {
    ...accountEn,
    ...brainEn,
    ...chatEn,
    ...commonEn,
    ...companionsEn,
    ...connectorsEn,
    ...encryptionEn,
    ...familyEn,
    ...managedEn,
    ...organizationEn,
    ...settingsEn,
    ...studioEn,
  },
  ar: {
    ...accountAr,
    ...brainAr,
    ...chatAr,
    ...commonAr,
    ...companionsAr,
    ...connectorsAr,
    ...encryptionAr,
    ...familyAr,
    ...managedAr,
    ...organizationAr,
    ...settingsAr,
    ...studioAr,
  },
} as const;

export type MessageKey = keyof typeof messages.en;

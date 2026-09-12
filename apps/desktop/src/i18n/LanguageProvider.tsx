import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { messages, type Locale, type MessageKey } from "./messages";

interface LanguageContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: (key: MessageKey) => string;
  toggleLocale: () => void;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "arrab.locale";

function readInitialLocale(): Locale {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "ar" ? "ar" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readInitialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "en" ? "ar" : "en");
  }, [locale, setLocale]);

  const dir = locale === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    document.documentElement.classList.toggle("locale-ar", locale === "ar");
  }, [dir, locale]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      dir,
      t: (key) => messages[locale][key],
      toggleLocale,
      setLocale,
    }),
    [dir, locale, setLocale, toggleLocale],
  );

  return createElement(LanguageContext.Provider, { value }, children);
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return ctx;
}

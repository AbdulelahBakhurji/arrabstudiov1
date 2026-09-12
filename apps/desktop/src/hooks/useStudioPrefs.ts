import { useEffect, useState } from "react";
import { readPrefs, subscribePrefs, type StudioPrefs } from "@/lib/prefs";

export function useStudioPrefs(): StudioPrefs {
  const [prefs, setPrefs] = useState<StudioPrefs>(() => readPrefs());

  useEffect(() => subscribePrefs(setPrefs), []);

  return prefs;
}

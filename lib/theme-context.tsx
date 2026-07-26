import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  colorsForScheme,
  type ColorScheme,
  type ThemeColors,
  type ThemePreference,
} from "./theme";

const STORAGE_KEY = "pantry_theme_preference";

type ThemeState = {
  preference: ThemePreference;
  resolvedScheme: ColorScheme;
  colors: ThemeColors;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeState | undefined>(undefined);

async function readPreference(): Promise<ThemePreference | null> {
  try {
    if (Platform.OS === "web") {
      const value = globalThis.localStorage?.getItem(STORAGE_KEY);
      return parsePreference(value);
    }
    const value = await SecureStore.getItemAsync(STORAGE_KEY);
    return parsePreference(value);
  } catch {
    return null;
  }
}

async function writePreference(preference: ThemePreference): Promise<void> {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(STORAGE_KEY, preference);
      return;
    }
    await SecureStore.setItemAsync(STORAGE_KEY, preference);
  } catch {
    // Preference is best-effort; ignore storage failures.
  }
}

function parsePreference(value: string | null | undefined): ThemePreference | null {
  if (value === "system" || value === "light" || value === "dark") return value;
  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    readPreference().then((stored) => {
      if (!cancelled && stored) setPreferenceState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void writePreference(next);
  }, []);

  const resolvedScheme: ColorScheme =
    preference === "system"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : preference;

  const colors = useMemo(() => colorsForScheme(resolvedScheme), [resolvedScheme]);

  const value = useMemo(
    () => ({ preference, resolvedScheme, colors, setPreference }),
    [preference, resolvedScheme, colors, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export type ColorScheme = "light" | "dark";
export type ThemePreference = "system" | ColorScheme;

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  primarySoft: string;
  danger: string;
  success: string;
  warning: string;
};

export const lightColors: ThemeColors = {
  background: "#ffffff",
  surface: "#fafafa",
  surfaceMuted: "#eeeeee",
  border: "#eeeeee",
  borderStrong: "#dddddd",
  text: "#222222",
  textSecondary: "#555555",
  textMuted: "#999999",
  primary: "#2f95dc",
  primaryText: "#ffffff",
  primarySoft: "#f0f7ff",
  danger: "#ff3b30",
  success: "#34c759",
  warning: "#f0a500",
};

export const darkColors: ThemeColors = {
  background: "#121212",
  surface: "#1e1e1e",
  surfaceMuted: "#2a2a2a",
  border: "#333333",
  borderStrong: "#3a3a3a",
  text: "#f2f2f2",
  textSecondary: "#b0b0b0",
  textMuted: "#888888",
  primary: "#4aa3e0",
  primaryText: "#ffffff",
  primarySoft: "#1a2a36",
  danger: "#ff453a",
  success: "#30d158",
  warning: "#ffb340",
};

export function colorsForScheme(scheme: ColorScheme): ThemeColors {
  return scheme === "dark" ? darkColors : lightColors;
}

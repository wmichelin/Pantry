import { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../lib/theme-context";
import type { ThemePreference } from "../lib/theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function ThemePreferencePicker() {
  const { preference, setPreference, colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        section: { marginTop: 32, marginBottom: 8 },
        title: {
          fontSize: 18,
          fontWeight: "600",
          color: colors.text,
          marginBottom: 10,
        },
        row: { flexDirection: "row", gap: 8 },
        option: {
          flex: 1,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          borderRadius: 8,
          paddingVertical: 10,
          alignItems: "center",
          backgroundColor: colors.background,
        },
        optionSelected: {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
        optionText: {
          fontSize: 14,
          fontWeight: "600",
          color: colors.textMuted,
        },
        optionTextSelected: { color: colors.primaryText },
      }),
    [colors]
  );

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Appearance</Text>
      <View style={styles.row}>
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <Pressable
              key={option.value}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => setPreference(option.value)}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

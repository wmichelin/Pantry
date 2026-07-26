import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth-context";
import type { ScrapedRecipe } from "../../lib/scrape-types";
import { useTheme } from "../../lib/theme-context";
import type { ThemeColors } from "../../lib/theme";

export default function ImportRecipeScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    // Avoid wasting a scrape call on plain text / typos.
    try {
      new URL(trimmed);
    } catch {
      Alert.alert("Invalid URL", "Enter a full link starting with http:// or https://.");
      return;
    }
    setLoading(true);

    const { data, error } = await supabase.functions.invoke("scrape-recipe", {
      body: { url: trimmed },
      headers: { Authorization: `Bearer ${session!.access_token}` },
    });

    setLoading(false);

    if (error || !data || data.error) {
      Alert.alert("Import failed", error?.message ?? data?.error ?? "Could not scrape that URL.");
      return;
    }

    if (data.type === "board") {
      const recipes: ScrapedRecipe[] = data.recipes ?? [];
      if (recipes.length === 0) {
        Alert.alert("Nothing found", "No recipes could be extracted from that board. Pinterest may have blocked the request.");
        return;
      }
      router.push({
        pathname: "/(app)/review-board",
        params: {
          householdId,
          recipesJson: JSON.stringify(recipes),
        },
      });
    } else {
      const recipe: ScrapedRecipe | undefined = data.recipe;
      if (!recipe) {
        Alert.alert("Nothing found", "No recipe could be extracted from that URL.");
        return;
      }
      router.push({
        pathname: "/(app)/review-recipe",
        params: {
          householdId,
          recipeJson: JSON.stringify(recipe),
        },
      });
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.label}>Recipe or Pinterest URL</Text>
      <TextInput
        style={styles.input}
        placeholder="https://..."
        placeholderTextColor={colors.textMuted}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        autoFocus
        multiline={false}
      />
      <Text style={styles.hint}>
        Paste a recipe URL, a Pinterest pin, or a Pinterest board URL to import all recipes at once.
      </Text>

      <Pressable
        style={[styles.button, (loading || !url.trim()) && styles.buttonDisabled]}
        onPress={handleImport}
        disabled={loading || !url.trim()}
      >
        {loading ? (
          <View style={styles.buttonRow}>
            <ActivityIndicator color={colors.primaryText} style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Scraping...</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Import</Text>
        )}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      padding: 24,
      backgroundColor: colors.background,
    },
    label: {
      fontSize: 16,
      fontWeight: "600",
      marginBottom: 8,
      marginTop: 16,
      color: colors.text,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 8,
      padding: 14,
      fontSize: 15,
      backgroundColor: colors.surface,
      color: colors.text,
    },
    hint: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 8,
      lineHeight: 18,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      padding: 16,
      alignItems: "center",
      marginTop: 24,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: "600",
    },
    buttonRow: {
      flexDirection: "row",
      alignItems: "center",
    },
  });
}

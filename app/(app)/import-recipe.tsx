import { useState } from "react";
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
import type { ScrapedRecipe } from "../../lib/scrape-types";

export default function ImportRecipeScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);

    const { data, error } = await supabase.functions.invoke("scrape-recipe", {
      body: { url: trimmed },
    });

    setLoading(false);

    if (error || data?.error) {
      Alert.alert("Import failed", error?.message ?? data?.error ?? "Could not scrape that URL.");
      return;
    }

    if (data.type === "board") {
      const recipes: ScrapedRecipe[] = data.recipes;
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
      const recipe: ScrapedRecipe = data.recipe;
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
            <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Scraping...</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Import</Text>
        )}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#fff",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    backgroundColor: "#fafafa",
  },
  hint: {
    fontSize: 13,
    color: "#999",
    marginTop: 8,
    lineHeight: 18,
  },
  button: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
  },
});

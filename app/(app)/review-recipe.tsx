import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { parseIngredients } from "../../lib/parse-ingredient";
import type { ScrapedRecipe } from "../../lib/scrape-types";
import TagEditor from "../../components/TagEditor";

export default function ReviewRecipeScreen() {
  const { householdId, recipeJson } = useLocalSearchParams<{
    householdId: string;
    recipeJson: string;
  }>();
  const { user } = useAuth();
  const router = useRouter();

  const scraped: ScrapedRecipe = JSON.parse(recipeJson);
  const [title, setTitle] = useState(scraped.title);
  const [selectedTags, setSelectedTags] = useState<string[]>(scraped.suggested_tags);
  const [saving, setSaving] = useState(false);

  const parsedIngredients = parseIngredients(scraped.raw_ingredients);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert("Missing title", "Give this recipe a name.");
      return;
    }
    setSaving(true);

    const { data: recipe, error: recipeError } = await supabase
      .from("recipes")
      .insert({
        title: title.trim(),
        household_id: householdId,
        created_by: user!.id,
        source_url: scraped.source_url,
        source_type: scraped.source_type,
        image_url: scraped.image_url,
        instructions: scraped.instructions,
        tags: selectedTags,
        servings: scraped.servings,
        prep_time_minutes: scraped.prep_time_minutes,
        cook_time_minutes: scraped.cook_time_minutes,
      })
      .select()
      .single();

    if (recipeError) {
      setSaving(false);
      Alert.alert("Error", recipeError.message);
      return;
    }

    if (parsedIngredients.length > 0) {
      await supabase.from("recipe_ingredients").insert(
        parsedIngredients.map((ing) => ({
          recipe_id: recipe.id,
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          raw_string: ing.raw_string,
        }))
      );
    }

    setSaving(false);
    router.replace({
      pathname: "/(app)/household",
      params: { id: householdId },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {scraped.image_url && (
        <Image source={{ uri: scraped.image_url }} style={styles.image} />
      )}

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
      />

      {scraped.servings || scraped.prep_time_minutes || scraped.cook_time_minutes ? (
        <View style={styles.metaRow}>
          {scraped.servings && (
            <Text style={styles.meta}>🍽 {scraped.servings} servings</Text>
          )}
          {scraped.prep_time_minutes && (
            <Text style={styles.meta}>⏱ {scraped.prep_time_minutes}m prep</Text>
          )}
          {scraped.cook_time_minutes && (
            <Text style={styles.meta}>🔥 {scraped.cook_time_minutes}m cook</Text>
          )}
        </View>
      ) : null}

      <Text style={styles.label}>Tags</Text>
      <TagEditor
        activeTags={selectedTags}
        suggestedTags={scraped.suggested_tags}
        onChange={setSelectedTags}
      />

      <Text style={styles.label}>
        Ingredients ({parsedIngredients.length})
      </Text>
      {parsedIngredients.length === 0 ? (
        <Text style={styles.empty}>No ingredients found.</Text>
      ) : (
        parsedIngredients.map((ing, i) => (
          <View key={i} style={styles.ingredientRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.ingredientText}>{ing.raw_string}</Text>
          </View>
        ))
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.saveButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save to Household</Text>
          )}
        </Pressable>

        <Pressable style={styles.discardButton} onPress={() => router.back()}>
          <Text style={styles.discardText}>Discard</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 24, paddingBottom: 48 },
  image: {
    width: "100%",
    height: 200,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: "#eee",
  },
  label: { fontSize: 16, fontWeight: "600", marginBottom: 8, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  metaRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
    flexWrap: "wrap",
  },
  meta: { fontSize: 14, color: "#555" },
  empty: { color: "#999", fontSize: 14 },
  ingredientRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  bullet: { color: "#2f95dc", fontSize: 16, marginTop: 1 },
  ingredientText: { flex: 1, fontSize: 15 },
  actions: { marginTop: 32, gap: 12 },
  saveButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  discardButton: { alignItems: "center", paddingVertical: 8 },
  discardText: { color: "#999", fontSize: 14 },
});

import { useEffect, useMemo, useState } from "react";
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
import { ensureCatalogIngredient } from "../../lib/ingredient-catalog";
import type { ScrapedRecipe } from "../../lib/scrape-types";
import TagEditor from "../../components/TagEditor";
import { importRecipe, parseImportIngredients, stagingImportParserAPIOrigin, stagingRecipeImportAPIOrigin, type ParsedImportIngredient } from "../../lib/pantry-api";
import { importedRecipeInput, saveImportedRecipe } from "../../lib/recipe-import";
import { SavedNotice, catalogSavedWarning } from "../../components/SavedNotice";

export default function ReviewRecipeScreen() {
  const { householdId, recipeJson } = useLocalSearchParams<{
    householdId: string;
    recipeJson: string;
  }>();
  const { user, session } = useAuth();
  const router = useRouter();

  const scraped: ScrapedRecipe = useMemo(() => JSON.parse(recipeJson), [recipeJson]);
  const [title, setTitle] = useState(scraped.title);
  const [selectedTags, setSelectedTags] = useState<string[]>(scraped.suggested_tags);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const parserURL = stagingImportParserAPIOrigin();
  const legacyParsedIngredients = useMemo(() => parseIngredients(scraped.raw_ingredients), [scraped]);
  const [parsedIngredients, setParsedIngredients] = useState<ParsedImportIngredient[]>(
    parserURL ? [] : legacyParsedIngredients
  );
  const [parsing, setParsing] = useState(parserURL !== null);
  const [parseError, setParseError] = useState("");
  const [parseAttempt, setParseAttempt] = useState(0);
  const finish = () => router.replace({ pathname: "/(app)/household", params: { id: householdId } });

  useEffect(() => {
    if (!parserURL) {
      setParsedIngredients(legacyParsedIngredients);
      setParsing(false);
      setParseError("");
      return;
    }
    let active = true;
    setParsing(true);
    setParseError("");
    if (!session?.access_token) {
      setParsing(false);
      setParseError("A valid Pantry session is required.");
      return;
    }
    parseImportIngredients(parserURL, session.access_token, householdId!, scraped.raw_ingredients)
      .then((ingredients) => { if (active) setParsedIngredients(ingredients); })
      .catch((error) => { if (active) setParseError(error instanceof Error ? error.message : "Could not parse ingredients."); })
      .finally(() => { if (active) setParsing(false); });
    return () => { active = false; };
  }, [householdId, legacyParsedIngredients, parseAttempt, parserURL, scraped.raw_ingredients, session?.access_token]);

  const handleSave = async () => {
    if (saving || parsing || parseError || savedNotice) return;
    let catalogFailed = false;
    if (!title.trim()) {
      Alert.alert("Missing title", "Give this recipe a name.");
      return;
    }
    setSaving(true);
    setSaveError("");

    const apiURL = stagingRecipeImportAPIOrigin();
    if (apiURL) {
      try {
        if (!session?.access_token) throw new Error("A valid Pantry session is required.");
        await saveImportedRecipe(importedRecipeInput(householdId!, scraped, title.trim(), selectedTags, parserURL !== null), {
          save: (input) => importRecipe(apiURL, session.access_token, input),
          ensureCatalog: (name) => ensureCatalogIngredient(householdId!, name),
          catalogWarning: () => { catalogFailed = true; },
        });
        if (catalogFailed) setSavedNotice(catalogSavedWarning);
        else finish();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not import recipe.");
      } finally {
        setSaving(false);
      }
      return;
    }

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

    if (recipeError || !recipe) {
      setSaving(false);
      Alert.alert(
        "Couldn't save recipe",
        recipeError?.message ?? "Pantry couldn't confirm that the recipe was saved. Please try again."
      );
      return;
    }

    if (parsedIngredients.length > 0) {
      const { error: ingredientsError } = await supabase.from("recipe_ingredients").insert(
        parsedIngredients.map((ing) => ({
          recipe_id: recipe.id,
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          raw_string: ing.raw_string,
        }))
      );

      if (ingredientsError) {
        // A recipe imported from this screen is only complete with its ingredients.
        // Remove the parent row before reporting failure so it cannot look saved.
        const { error: rollbackError } = await supabase
          .from("recipes")
          .delete()
          .eq("id", recipe.id);
        setSaving(false);
        Alert.alert(
          "Couldn't save recipe",
          rollbackError
            ? "The ingredients could not be saved, and Pantry could not remove the incomplete recipe. It may appear without ingredients; please try again after checking your connection."
            : "The ingredients could not be saved, so the recipe was not added. Please try again."
        );
        return;
      }

      // Catalog grows with cleaned names (qty/units already stripped by parse).
      for (const ing of parsedIngredients) {
        try {
          await ensureCatalogIngredient(householdId!, ing.name);
        } catch {
          catalogFailed = true;
        }
      }
    }

    setSaving(false);
    if (catalogFailed) setSavedNotice(catalogSavedWarning);
    else finish();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SavedNotice message={savedNotice} onContinue={finish} />
      {!!saveError && <Text style={styles.error}>{saveError}</Text>}
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
      {parsing ? (
        <ActivityIndicator color="#2f95dc" />
      ) : parseError ? (
        <View>
          <Text style={styles.error}>{parseError}</Text>
          <Pressable onPress={() => setParseAttempt((attempt) => attempt + 1)}>
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : parsedIngredients.length === 0 ? (
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
          style={[styles.saveButton, (saving || parsing || !!parseError) && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving || parsing || !!parseError}
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
  error: { color: "#b42318", fontSize: 14, marginBottom: 8 },
  retry: { color: "#2f95dc", fontSize: 14, fontWeight: "600" },
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

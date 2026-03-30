import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { parseIngredients } from "../../lib/parse-ingredient";
import type { ScrapedRecipe } from "../../lib/scrape-types";

export default function ReviewBoardScreen() {
  const { householdId, recipesJson } = useLocalSearchParams<{
    householdId: string;
    recipesJson: string;
  }>();
  const { user } = useAuth();
  const router = useRouter();

  const recipes: ScrapedRecipe[] = JSON.parse(recipesJson);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(recipes.map((_, i) => i))
  );
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === recipes.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(recipes.map((_, i) => i)));
    }
  };

  const handleSave = async () => {
    const toSave = recipes.filter((_, i) => selected.has(i));
    if (toSave.length === 0) {
      Alert.alert("Nothing selected", "Select at least one recipe to save.");
      return;
    }
    setSaving(true);
    setSaveProgress(0);

    let saved = 0;
    for (const scraped of toSave) {
      const { data: recipe, error } = await supabase
        .from("recipes")
        .insert({
          title: scraped.title,
          household_id: householdId,
          created_by: user!.id,
          source_url: scraped.source_url,
          source_type: scraped.source_type,
          image_url: scraped.image_url,
          instructions: scraped.instructions,
          tags: scraped.suggested_tags,
          servings: scraped.servings,
          prep_time_minutes: scraped.prep_time_minutes,
          cook_time_minutes: scraped.cook_time_minutes,
        })
        .select()
        .single();

      if (!error && recipe && scraped.raw_ingredients.length > 0) {
        const parsed = parseIngredients(scraped.raw_ingredients);
        await supabase.from("recipe_ingredients").insert(
          parsed.map((ing) => ({
            recipe_id: recipe.id,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            raw_string: ing.raw_string,
          }))
        );
      }

      saved++;
      setSaveProgress(saved);
    }

    setSaving(false);
    router.dismissAll();
    router.replace({
      pathname: "/(app)/household",
      params: { id: householdId },
    });
  };

  const selectedCount = selected.size;
  const allSelected = selected.size === recipes.length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {recipes.length} recipes found
        </Text>
        <Pressable onPress={toggleAll}>
          <Text style={styles.toggleAll}>
            {allSelected ? "Deselect all" : "Select all"}
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={recipes}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const isSelected = selected.has(index);
          return (
            <Pressable
              style={[styles.card, !isSelected && styles.cardDeselected]}
              onPress={() => toggleSelect(index)}
            >
              {item.image_url ? (
                <Image
                  source={{ uri: item.image_url }}
                  style={styles.thumbnail}
                />
              ) : (
                <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                  <Text style={styles.thumbnailPlaceholderText}>🍽</Text>
                </View>
              )}
              <View style={styles.cardBody}>
                <Text
                  style={[styles.cardTitle, !isSelected && styles.cardTitleDeselected]}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                {item.raw_ingredients.length > 0 && (
                  <Text style={styles.cardMeta}>
                    {item.raw_ingredients.length} ingredients
                  </Text>
                )}
                {item.suggested_tags.length > 0 && (
                  <Text style={styles.cardTags} numberOfLines={1}>
                    {item.suggested_tags.join(" · ")}
                  </Text>
                )}
              </View>
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </Pressable>
          );
        }}
      />

      <View style={styles.footer}>
        {saving ? (
          <View style={styles.savingRow}>
            <ActivityIndicator color="#2f95dc" />
            <Text style={styles.savingText}>
              Saving {saveProgress} / {selectedCount}...
            </Text>
          </View>
        ) : (
          <Pressable
            style={[styles.saveButton, selectedCount === 0 && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={selectedCount === 0}
          >
            <Text style={styles.saveButtonText}>
              Save {selectedCount} recipe{selectedCount !== 1 ? "s" : ""}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerText: { fontSize: 15, fontWeight: "600", color: "#333" },
  toggleAll: { fontSize: 14, color: "#2f95dc", fontWeight: "600" },
  list: { padding: 12, gap: 8 },
  card: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    overflow: "hidden",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  cardDeselected: { opacity: 0.45 },
  thumbnail: { width: 72, height: 72, backgroundColor: "#eee" },
  thumbnailPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  thumbnailPlaceholderText: { fontSize: 24 },
  cardBody: { flex: 1, padding: 10, gap: 2 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#222", lineHeight: 19 },
  cardTitleDeselected: { color: "#999" },
  cardMeta: { fontSize: 12, color: "#888" },
  cardTags: { fontSize: 11, color: "#aaa", marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#ccc",
    marginHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxSelected: {
    backgroundColor: "#2f95dc",
    borderColor: "#2f95dc",
  },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
  },
  saveButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  savingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 8,
  },
  savingText: { fontSize: 15, color: "#555" },
});

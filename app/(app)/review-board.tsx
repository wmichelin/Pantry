import { useState, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { parseIngredients } from "../../lib/parse-ingredient";
import { ensureCatalogIngredient } from "../../lib/ingredient-catalog";
import type { ScrapedRecipe } from "../../lib/scrape-types";
import { useTheme } from "../../lib/theme-context";
import type { ThemeColors } from "../../lib/theme";
import TagEditor from "../../components/TagEditor";

export default function ReviewBoardScreen() {
  const { householdId, recipesJson } = useLocalSearchParams<{
    householdId: string;
    recipesJson: string;
  }>();
  const { user } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const recipes: ScrapedRecipe[] = JSON.parse(recipesJson);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(recipes.map((_, i) => i).filter((i) => recipes[i].raw_ingredients.length > 0))
  );
  const [tagSelections, setTagSelections] = useState<Record<number, string[]>>(
    () => Object.fromEntries(recipes.map((r, i) => [i, r.suggested_tags]))
  );
  const [editingCardIndex, setEditingCardIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const scrapedIndices = recipes.map((_, i) => i).filter((i) => recipes[i].raw_ingredients.length > 0);

  const toggleAll = () => {
    if (selected.size === scrapedIndices.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(scrapedIndices));
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

    const { data: existing } = await supabase
      .from("recipes")
      .select("source_url")
      .eq("household_id", householdId);
    const existingUrls = new Set((existing ?? []).map((r) => r.source_url).filter(Boolean));

    const deduped = toSave.filter((r) => !r.source_url || !existingUrls.has(r.source_url));

    let saved = 0;
    const failed: string[] = [];
    for (const scraped of deduped) {
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
          tags: tagSelections[recipes.indexOf(scraped)] ?? scraped.suggested_tags,
          servings: scraped.servings,
          prep_time_minutes: scraped.prep_time_minutes,
          cook_time_minutes: scraped.cook_time_minutes,
        })
        .select()
        .single();

      if (error || !recipe) {
        failed.push(scraped.title);
        continue;
      }

      if (scraped.raw_ingredients.length > 0) {
        const parsed = parseIngredients(scraped.raw_ingredients);
        const { error: ingError } = await supabase.from("recipe_ingredients").insert(
          parsed.map((ing) => ({
            recipe_id: recipe.id,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            raw_string: ing.raw_string,
          }))
        );
        if (ingError) failed.push(`${scraped.title} (ingredients)`);
        else {
          for (const ing of parsed) {
            try {
              await ensureCatalogIngredient(householdId!, ing.name);
            } catch (err) {
              console.warn("Catalog upsert after import failed", err);
            }
          }
        }
      }

      saved++;
      setSaveProgress(saved);
    }

    setSaving(false);
    if (failed.length > 0) {
      Alert.alert(
        "Some recipes didn't save",
        `Saved ${saved} of ${deduped.length}.\n\nNot saved: ${failed.join(", ")}`
      );
    }
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
                {item.raw_ingredients.length > 0 ? (
                  <Text style={styles.cardMeta}>
                    {item.raw_ingredients.length} ingredients
                  </Text>
                ) : (
                  <Text style={styles.cardWarning}>No ingredients found</Text>
                )}
                <View style={styles.cardTagRow}>
                  {item.suggested_tags.map((tag) => {
                    const active = (tagSelections[index] ?? []).includes(tag);
                    return (
                      <Pressable
                        key={tag}
                        style={[styles.cardTagPill, active && styles.cardTagPillActive]}
                        onPress={() => {
                          const current = tagSelections[index] ?? [];
                          setTagSelections((prev) => ({
                            ...prev,
                            [index]: active
                              ? current.filter((t) => t !== tag)
                              : [...current, tag],
                          }));
                        }}
                      >
                        <Text style={[styles.cardTagText, active && styles.cardTagTextActive]}>
                          {tag}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    style={styles.cardTagAdd}
                    onPress={() => setEditingCardIndex(index)}
                  >
                    <Text style={styles.cardTagAddText}>+</Text>
                  </Pressable>
                </View>
              </View>
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </Pressable>
          );
        }}
      />

      <Modal
        visible={editingCardIndex !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingCardIndex(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {editingCardIndex !== null && (
              <>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {recipes[editingCardIndex].title}
                </Text>
                <ScrollView style={styles.modalScroll}>
                  <TagEditor
                    activeTags={tagSelections[editingCardIndex] ?? []}
                    suggestedTags={recipes[editingCardIndex].suggested_tags}
                    onChange={(tags) =>
                      setTagSelections((prev) => ({ ...prev, [editingCardIndex]: tags }))
                    }
                  />
                </ScrollView>
                <Pressable
                  style={styles.modalDone}
                  onPress={() => setEditingCardIndex(null)}
                >
                  <Text style={styles.modalDoneText}>Done</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <View style={styles.footer}>
        {saving ? (
          <View style={styles.savingRow}>
            <ActivityIndicator color={colors.primary} />
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: { fontSize: 15, fontWeight: "600", color: colors.text },
  toggleAll: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  list: { padding: 12, gap: 8 },
  card: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: "hidden",
    backgroundColor: colors.background,
    alignItems: "center",
  },
  cardDeselected: { opacity: 0.45 },
  thumbnail: { width: 72, height: 72, backgroundColor: colors.surfaceMuted },
  thumbnailPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  thumbnailPlaceholderText: { fontSize: 24 },
  cardBody: { flex: 1, padding: 10, gap: 2 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 19 },
  cardTitleDeselected: { color: colors.textMuted },
  cardMeta: { fontSize: 12, color: colors.textMuted },
  cardWarning: { fontSize: 12, color: colors.warning, fontWeight: "600" },
  cardTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  cardTagPill: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  cardTagPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  cardTagText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  cardTagTextActive: {
    color: colors.primaryText,
    fontWeight: "600",
  },
  cardTagAdd: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTagAddText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 40,
    maxHeight: "60%",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 16,
    color: colors.text,
  },
  modalScroll: {
    marginBottom: 16,
  },
  modalDone: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  modalDoneText: {
    color: colors.primaryText,
    fontSize: 16,
    fontWeight: "600",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textMuted,
    marginHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: { color: colors.primaryText, fontSize: 13, fontWeight: "700" },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  saveButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
  savingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 8,
  },
  savingText: { fontSize: 15, color: colors.textSecondary },
  });
}

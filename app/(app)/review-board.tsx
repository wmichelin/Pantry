import { useRef, useState } from "react";
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
import TagEditor from "../../components/TagEditor";
import { importBoard, importRecipe, stagingBoardImportAPIOrigin, stagingImportParserAPIOrigin, stagingRecipeImportAPIOrigin, validateBoardImportInputs } from "../../lib/pantry-api";
import { importedRecipeInput, saveImportedBoard } from "../../lib/recipe-import";
import { recipeAPI, stagingRecipeManagementAPIOrigin } from "../../lib/recipe-api";
import { SavedNotice, catalogSavedWarning } from "../../components/SavedNotice";
import { boardRecoveryMarkersPresent, boardResumeState } from "../../lib/board-import-recovery";

export default function ReviewBoardScreen() {
  const { householdId, recipesJson, boardOperationId, boardSelectionJson, boardTagsJson } = useLocalSearchParams<{
    householdId: string;
    recipesJson: string;
    boardOperationId?: string;
    boardSelectionJson?: string;
    boardTagsJson?: string;
  }>();
  const { user, session } = useAuth();
  const router = useRouter();

  const recipes: ScrapedRecipe[] = JSON.parse(recipesJson);
  const resume = boardResumeState(recipes, boardOperationId, boardSelectionJson, boardTagsJson);
  const invalidRecovery = boardRecoveryMarkersPresent(boardOperationId, boardSelectionJson, boardTagsJson) && !resume;
  const [selected, setSelected] = useState<Set<number>>(
    () => resume?.selected ?? new Set(recipes.map((_, i) => i).filter((i) => recipes[i].raw_ingredients.length > 0))
  );
  const [tagSelections, setTagSelections] = useState<Record<number, string[]>>(
    () => resume?.tags ?? Object.fromEntries(recipes.map((r, i) => [i, r.suggested_tags]))
  );
  const [editingCardIndex, setEditingCardIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [savedNotice, setSavedNotice] = useState("");
  const [saveError, setSaveError] = useState(invalidRecovery
    ? "This board import recovery link is incomplete or invalid. Pantry blocked a new save to avoid duplicating an unconfirmed recipe. Return to your recipes and review what was saved before trying again."
    : "");
  const [canRetry, setCanRetry] = useState(false);
  const operationID = useRef(resume?.operationID ?? "");
  const savingRef = useRef(false);
  const [operationStarted, setOperationStarted] = useState(operationID.current !== "");
  const finish = () => router.replace({ pathname: "/(app)/household", params: { id: householdId } });

  const toggleSelect = (index: number) => {
    if (saving || operationStarted) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const scrapedIndices = recipes.map((_, i) => i).filter((i) => recipes[i].raw_ingredients.length > 0);

  const toggleAll = () => {
    if (saving || operationStarted) return;
    if (selected.size === scrapedIndices.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(scrapedIndices));
    }
  };

  const handleSave = async (resume = false) => {
    if (savingRef.current || saving || (savedNotice && !resume)) return;
    savingRef.current = true;
    try {
    if (resume) {
      setSavedNotice("");
      setSaveError("");
    }
    let catalogFailed = false;
    const toSave = recipes.filter((_, i) => selected.has(i));
    if (toSave.length === 0) {
      Alert.alert("Nothing selected", "Select at least one recipe to save.");
      return;
    }
    let boardAPIURL: string | null;
    let apiURL: string | null;
    try {
      boardAPIURL = stagingBoardImportAPIOrigin();
      apiURL = boardAPIURL ? null : stagingRecipeImportAPIOrigin();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not configure board import.");
      return;
    }
    setSaving(true);
    setSaveProgress(0);

    if (boardAPIURL) {
      try {
        if (!session?.access_token) throw new Error("A valid Pantry session is required.");
        const inputs = recipes.flatMap((recipe, index) => selected.has(index)
          ? [{ ...importedRecipeInput(householdId!, recipe, recipe.title, tagSelections[index] ?? recipe.suggested_tags, true), item_index: index, raw_ingredients: recipe.raw_ingredients }]
          : []);
        validateBoardImportInputs(inputs, householdId!);
        if (!operationID.current) {
          operationID.current = createBoardOperationID();
          router.setParams({
            boardOperationId: operationID.current,
            boardSelectionJson: JSON.stringify(inputs.map((input) => input.item_index)),
            boardTagsJson: JSON.stringify(Object.fromEntries(inputs.map((input) => [input.item_index, input.metadata.tags]))),
          });
        }
        setOperationStarted(true);
        setCanRetry(false);
        const result = await importBoard(boardAPIURL, session.access_token, householdId!, operationID.current, inputs, (progress) => {
          setSaveProgress(progress.processed);
        });
        catalogFailed = result.catalog_warning;
        if (result.failed || catalogFailed) {
          setCanRetry(result.failed > 0);
          setSavedNotice(`Saved ${result.saved}. Skipped ${result.skipped}.${result.failed ? `\n\nNot confirmed; retry safely: ${result.failed_titles.join(", ")}` : ""}${catalogFailed ? `\n\n${catalogSavedWarning}` : ""}`);
        } else finish();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not import board.");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (apiURL) {
      try {
        if (!session?.access_token) throw new Error("A valid Pantry session is required.");
        const parseInGo = stagingImportParserAPIOrigin() !== null;
        const inputs = recipes.flatMap((recipe, index) => selected.has(index)
          ? [importedRecipeInput(householdId!, recipe, recipe.title, tagSelections[index] ?? recipe.suggested_tags, parseInGo)] : []);
        const result = await saveImportedBoard(inputs, {
          save: (input) => importRecipe(apiURL, session.access_token, input),
          ensureCatalog: (name) => ensureCatalogIngredient(householdId!, name),
          catalogWarning: () => { catalogFailed = true; },
          progress: setSaveProgress,
          existingURLs: async () => {
            const readURL = stagingRecipeManagementAPIOrigin();
            if (readURL) {
              const rows = await recipeAPI(readURL, session.access_token).list(householdId!);
              return rows.flatMap(recipe => recipe.source_url ? [recipe.source_url] : []);
            }
            const { data, error } = await supabase.from("recipes").select("source_url").eq("household_id", householdId);
            if (error) throw new Error("Couldn't check existing recipes. Nothing was imported.");
            return (data ?? []).flatMap((recipe) => recipe.source_url ? [recipe.source_url] : []);
          },
        });
        if (result.failed.length || catalogFailed) {
          setSavedNotice(`Saved ${result.saved}. Skipped ${result.skipped}.${result.failed.length ? `\n\nNot saved: ${result.failed.join(", ")}` : ""}${catalogFailed ? `\n\n${catalogSavedWarning}` : ""}`);
        } else finish();
      } catch (error) {
        Alert.alert("Couldn't import board", error instanceof Error ? error.message : "Could not import board.");
      } finally {
        setSaving(false);
      }
      return;
    }

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
            } catch {
              catalogFailed = true;
            }
          }
        }
      }

      saved++;
      setSaveProgress(saved);
    }

    setSaving(false);
    if (failed.length || catalogFailed) {
      setSavedNotice(`Saved ${saved} of ${deduped.length}.${failed.length ? `\n\nNot saved: ${failed.join(", ")}` : ""}${catalogFailed ? `\n\n${catalogSavedWarning}` : ""}`);
    } else finish();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const selectedCount = selected.size;
  const allSelected = selected.size === scrapedIndices.length;

  return (
    <View style={styles.container}>
      <SavedNotice message={savedNotice} onContinue={finish} onRetry={canRetry ? () => { void handleSave(true); } : undefined} />
      <SavedNotice
        message={saveError}
        title={invalidRecovery ? "Import recovery unavailable" : operationStarted ? "Import interrupted" : "Couldn’t import board"}
        continueLabel={invalidRecovery ? "Return to recipes" : "Back to board"}
        onContinue={invalidRecovery ? finish : () => setSaveError("")}
        onRetry={!invalidRecovery && operationStarted ? () => { void handleSave(true); } : undefined}
      />
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {recipes.length} recipes found
        </Text>
        <Pressable onPress={toggleAll} disabled={saving || operationStarted}>
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
              disabled={saving || operationStarted}
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
                        disabled={saving || operationStarted}
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
                    disabled={saving || operationStarted}
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
            <ActivityIndicator color="#2f95dc" />
            <Text style={styles.savingText}>
              Saving {saveProgress} / {selectedCount}...
            </Text>
          </View>
        ) : (
          <Pressable
            style={[styles.saveButton, selectedCount === 0 && styles.buttonDisabled]}
            onPress={() => { void handleSave(); }}
            disabled={selectedCount === 0 || invalidRecovery}
          >
            <Text style={styles.saveButtonText}>
              {operationStarted ? "Resume" : "Save"} {selectedCount} recipe{selectedCount !== 1 ? "s" : ""}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function createBoardOperationID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  cardWarning: { fontSize: 12, color: "#f0a500", fontWeight: "600" },
  cardTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  cardTagPill: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  cardTagPillActive: {
    backgroundColor: "#2f95dc",
    borderColor: "#2f95dc",
  },
  cardTagText: {
    fontSize: 10,
    color: "#888",
  },
  cardTagTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  cardTagAdd: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTagAddText: {
    fontSize: 12,
    color: "#aaa",
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
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
  },
  modalScroll: {
    marginBottom: 16,
  },
  modalDone: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  modalDoneText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
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

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { showError, throwOnError } from "../../lib/db";
import TagEditor from "../../components/TagEditor";

type Recipe = { id: string; title: string; tags: string[] | null };
type Household = { id: string; name: string };
type QueueEntry = {
  id: string;
  recipe_id: string;
  recipes: { id: string; title: string };
};

export default function HouseholdScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Recipe[]>([]);
  const [searching, setSearching] = useState(false);
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);

  const queuedIds = useMemo(
    () => new Set(queueEntries.map((e) => e.recipe_id)),
    [queueEntries]
  );
  const queueCount = queueEntries.length;

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [hRes, rRes, qRes] = await Promise.all([
        supabase.from("households").select("id, name").eq("id", id).single(),
        supabase.from("recipes").select("id, title, tags").eq("household_id", id).order("created_at", { ascending: false }),
        supabase
          .from("week_queues")
          .select("id, recipe_id, recipes(id, title)")
          .eq("household_id", id)
          .order("created_at", { ascending: true }),
      ]);
      if (hRes.error) throw hRes.error;
      if (qRes.error) throw qRes.error;
      setHousehold(hRes.data);
      if (rRes.data) setRecipes(rRes.data);
      // recipe_id -> recipes is to-one; runtime is a single object despite inference.
      setQueueEntries((qRes.data as unknown as QueueEntry[]) ?? []);
    } catch (err) {
      showError("Couldn't load household", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const allKnownTags = useMemo(
    () => [...new Set(recipes.flatMap((r) => r.tags ?? []))].sort(),
    [recipes]
  );

  const saveTagEdit = async () => {
    if (!editingRecipe) return;
    setSavingTags(true);
    try {
      throwOnError(await supabase.from("recipes").update({ tags: editingTags }).eq("id", editingRecipe.id));
      setRecipes((prev) =>
        prev.map((r) => (r.id === editingRecipe.id ? { ...r, tags: editingTags } : r))
      );
      setEditingRecipe(null);
    } catch (err) {
      // Keep the modal open so the edit isn't lost.
      showError("Couldn't save tags", err);
    } finally {
      setSavingTags(false);
    }
  };

  const handleQueueToggle = async (recipe: Recipe) => {
    const wasQueued = queuedIds.has(recipe.id);
    // Optimistic update, reverted below if the write fails.
    if (wasQueued) {
      setQueueEntries((prev) => prev.filter((e) => e.recipe_id !== recipe.id));
    } else {
      setQueueEntries((prev) => [
        ...prev,
        {
          id: `temp-${recipe.id}`,
          recipe_id: recipe.id,
          recipes: { id: recipe.id, title: recipe.title },
        },
      ]);
    }
    const { error } = wasQueued
      ? await supabase.from("week_queues").delete().eq("household_id", id).eq("recipe_id", recipe.id)
      : await supabase.from("week_queues").insert({
          household_id: id,
          recipe_id: recipe.id,
          added_by: user!.id,
        });
    if (error) {
      if (wasQueued) {
        setQueueEntries((prev) => [
          ...prev,
          {
            id: `temp-${recipe.id}`,
            recipe_id: recipe.id,
            recipes: { id: recipe.id, title: recipe.title },
          },
        ]);
      } else {
        setQueueEntries((prev) => prev.filter((e) => e.recipe_id !== recipe.id));
      }
      showError("Couldn't update the queue", error);
      return;
    }
    // Refresh so new rows get real queue ids and stable order.
    if (!wasQueued) loadData();
  };

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const q = query.toLowerCase();
      const titleMatches = recipes.filter((r) => r.title.toLowerCase().includes(q));
      const titleMatchIds = new Set(titleMatches.map((r) => r.id));
      const recipeIds = recipes.map((r) => r.id);
      if (recipeIds.length > 0) {
        const { data } = await supabase
          .from("recipe_ingredients")
          .select("recipe_id")
          .ilike("name", `%${q}%`)
          .in("recipe_id", recipeIds);
        const ingredientMatchIds = new Set((data ?? []).map((r) => r.recipe_id));
        const allMatchIds = new Set([...titleMatchIds, ...ingredientMatchIds]);
        setSearchResults(recipes.filter((r) => allMatchIds.has(r.id)));
      } else {
        setSearchResults(titleMatches);
      }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, recipes]);

  const taggedSections = useMemo(() => {
    const map = new Map<string, Recipe[]>();
    for (const recipe of recipes) {
      const tags = recipe.tags && recipe.tags.length > 0 ? recipe.tags : ["Untagged"];
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag)!.push(recipe);
      }
    }
    const sections: { tag: string; recipes: Recipe[] }[] = [];
    for (const [tag, items] of map) {
      if (tag !== "Untagged") sections.push({ tag, recipes: items });
    }
    if (map.has("Untagged")) sections.push({ tag: "Untagged", recipes: map.get("Untagged")! });
    return sections;
  }, [recipes]);

  const toggleTag = (tag: string) => {
    setExpandedTags((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Header row */}
      <View style={styles.headerRow}>
        <Text style={styles.householdName}>{household?.name}</Text>
        <Pressable
          onPress={() => router.push({ pathname: "/(app)/household-edit", params: { id } })}
        >
          <Text style={styles.editLink}>Edit ›</Text>
        </Pressable>
      </View>

      {/* This Week hero */}
      <View style={styles.weekSection}>
        <View style={styles.weekHeader}>
          <View style={styles.weekHeaderLeft}>
            <Text style={styles.weekTitle}>This Week</Text>
            <Text style={styles.weekCount}>
              {queueCount > 0 ? `${queueCount} meal${queueCount === 1 ? "" : "s"}` : "No meals"}
            </Text>
          </View>
          <Pressable
            onPress={() =>
              router.push({ pathname: "/(app)/week-queue", params: { householdId: id } })
            }
          >
            <Text style={styles.manageLink}>Manage →</Text>
          </Pressable>
        </View>

        {queueCount === 0 ? (
          <Text style={styles.weekEmpty}>No meals planned — add recipes below</Text>
        ) : (
          queueEntries.map((entry) => {
            const recipe: Recipe = {
              id: entry.recipe_id,
              title: entry.recipes.title,
              tags: null,
            };
            return (
              <View key={entry.id} style={styles.weekRow}>
                <Pressable
                  style={styles.weekRowTitleArea}
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/recipe/[id]",
                      params: { id: entry.recipe_id },
                    })
                  }
                >
                  <Text style={styles.weekRowTitle}>{entry.recipes.title}</Text>
                </Pressable>
                <Pressable style={styles.queueToggle} onPress={() => handleQueueToggle(recipe)}>
                  <Text style={[styles.queueDot, styles.queueDotActive]}>●</Text>
                </Pressable>
              </View>
            );
          })
        )}

        <Pressable
          style={[styles.shoppingButton, queueCount === 0 && styles.shoppingButtonMuted]}
          onPress={() =>
            router.push({ pathname: "/(app)/shopping-list", params: { householdId: id } })
          }
        >
          <Text
            style={[
              styles.shoppingButtonText,
              queueCount === 0 && styles.shoppingButtonTextMuted,
            ]}
          >
            Shopping List
          </Text>
        </Pressable>
        {queueCount === 0 && (
          <Text style={styles.shoppingHint}>Add meals to build a list</Text>
        )}
      </View>

      {/* Add recipes */}
      <View style={styles.recipesHeader}>
        <Text style={styles.sectionTitle}>Add recipes ({recipes.length})</Text>
        <View style={styles.recipeActions}>
          <Pressable
            style={[styles.actionButton, styles.importButton]}
            onPress={() => router.push({ pathname: "/(app)/import-recipe", params: { householdId: id } })}
          >
            <Text style={styles.importButtonText}>↓ Import</Text>
          </Pressable>
          <Pressable
            style={styles.actionButton}
            onPress={() => router.push({ pathname: "/(app)/create-recipe", params: { householdId: id } })}
          >
            <Text style={styles.addButtonText}>+ Add</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by title or ingredient…"
          value={query}
          onChangeText={setQuery}
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {query.trim() ? (
        searching ? (
          <ActivityIndicator style={styles.searchSpinner} />
        ) : searchResults.length === 0 ? (
          <Text style={styles.emptyText}>No recipes found.</Text>
        ) : (
          searchResults.map((item) => (
            <View key={item.id} style={styles.recipeRow}>
              <Pressable
                style={styles.recipeTitleArea}
                onPress={() => router.push({ pathname: "/(app)/recipe/[id]", params: { id: item.id } })}
              >
                <Text style={styles.recipeTitle}>{item.title}</Text>
              </Pressable>
              <Pressable style={styles.queueToggle} onPress={() => handleQueueToggle(item)}>
                <Text style={[styles.queueDot, queuedIds.has(item.id) && styles.queueDotActive]}>
                  {queuedIds.has(item.id) ? "●" : "○"}
                </Text>
              </Pressable>
              <Pressable onPress={() => router.push({ pathname: "/(app)/recipe/[id]", params: { id: item.id } })}>
                <Text style={styles.chevron}>&rsaquo;</Text>
              </Pressable>
            </View>
          ))
        )
      ) : recipes.length === 0 ? (
        <Text style={styles.emptyText}>No recipes yet. Add your first one!</Text>
      ) : (
        taggedSections.map(({ tag, recipes: sectionRecipes }) => {
          const expanded = expandedTags.has(tag);
          return (
            <View key={tag}>
              <Pressable style={styles.tagHeader} onPress={() => toggleTag(tag)}>
                <Text style={styles.tagHeaderText}>{tag} ({sectionRecipes.length})</Text>
                <Text style={styles.tagChevron}>{expanded ? "⌄" : "›"}</Text>
              </Pressable>
              {expanded && sectionRecipes.map((item) => (
                <View key={item.id} style={styles.recipeRow}>
                  <Pressable
                    style={styles.recipeTitleArea}
                    onPress={() => router.push({ pathname: "/(app)/recipe/[id]", params: { id: item.id } })}
                  >
                    <Text style={styles.recipeTitle}>{item.title}</Text>
                    <Pressable
                      style={styles.recipeTagsArea}
                      onPress={() => {
                        setEditingRecipe(item);
                        setEditingTags(item.tags ?? []);
                      }}
                    >
                      {item.tags && item.tags.length > 0 ? (
                        <View style={styles.inlineTags}>
                          {item.tags.map((t) => (
                            <View key={t} style={styles.inlineTag}>
                              <Text style={styles.inlineTagText}>{t}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.addTagHint}>+ add tags</Text>
                      )}
                    </Pressable>
                  </Pressable>
                  <Pressable style={styles.queueToggle} onPress={() => handleQueueToggle(item)}>
                    <Text style={[styles.queueDot, queuedIds.has(item.id) && styles.queueDotActive]}>
                      {queuedIds.has(item.id) ? "●" : "○"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => router.push({ pathname: "/(app)/recipe/[id]", params: { id: item.id } })}>
                    <Text style={styles.chevron}>&rsaquo;</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })
      )}

      <Pressable
        style={styles.ingredientsLink}
        onPress={() =>
          router.push({ pathname: "/(app)/ingredients", params: { householdId: id } })
        }
      >
        <Text style={styles.ingredientsLinkText}>Ingredients catalog →</Text>
      </Pressable>

      <Modal
        visible={editingRecipe !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingRecipe(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Edit Tags</Text>
            {editingRecipe && (
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {editingRecipe.title}
              </Text>
            )}
            <TagEditor
              activeTags={editingTags}
              suggestedTags={allKnownTags}
              onChange={setEditingTags}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalSave, savingTags && styles.buttonDisabled]}
                onPress={saveTagEdit}
                disabled={savingTags}
              >
                {savingTags ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalSaveText}>Save</Text>
                )}
              </Pressable>
              <Pressable style={styles.modalCancel} onPress={() => setEditingRecipe(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 24, paddingBottom: 48 },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  householdName: {
    fontSize: 28,
    fontWeight: "700",
    flex: 1,
  },
  editLink: {
    fontSize: 15,
    color: "#aaa",
    paddingLeft: 12,
  },

  weekSection: {
    borderRadius: 10,
    backgroundColor: "#f6fff8",
    borderWidth: 1,
    borderColor: "#b8edc6",
    borderLeftWidth: 4,
    borderLeftColor: "#34c759",
    marginBottom: 28,
    padding: 14,
  },
  weekHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  weekHeaderLeft: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    flex: 1,
  },
  weekTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a7a35",
  },
  weekCount: {
    fontSize: 13,
    color: "#34c759",
    fontWeight: "600",
  },
  manageLink: {
    fontSize: 13,
    color: "#34c759",
    fontWeight: "600",
    paddingLeft: 12,
  },
  weekEmpty: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
    lineHeight: 20,
  },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#d4f0dd",
  },
  weekRowTitleArea: { flex: 1 },
  weekRowTitle: { fontSize: 15, color: "#222" },

  shoppingButton: {
    marginTop: 14,
    backgroundColor: "#34c759",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  shoppingButtonMuted: {
    backgroundColor: "#e8f5ec",
  },
  shoppingButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  shoppingButtonTextMuted: {
    color: "#7aab88",
  },
  shoppingHint: {
    marginTop: 8,
    fontSize: 12,
    color: "#7aab88",
    textAlign: "center",
  },

  ingredientsLink: {
    marginTop: 28,
    paddingVertical: 8,
    alignItems: "center",
  },
  ingredientsLinkText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#999",
  },

  sectionTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  recipesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  recipeActions: { flexDirection: "row", gap: 8 },
  actionButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  importButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2f95dc",
  },
  importButtonText: { color: "#2f95dc", fontSize: 14, fontWeight: "600" },

  searchBar: { marginBottom: 8, marginTop: 4 },
  searchInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fafafa",
  },
  searchSpinner: { marginTop: 24 },

  emptyText: { color: "#999", textAlign: "center", marginTop: 16 },

  tagHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    backgroundColor: "#f8f8f8",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    marginTop: 8,
  },
  tagHeaderText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tagChevron: { fontSize: 18, color: "#aaa" },

  recipeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  recipeTitleArea: { flex: 1 },
  recipeTitle: { fontSize: 16 },
  recipeTagsArea: { marginTop: 4 },
  inlineTags: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  inlineTag: {
    backgroundColor: "#f0f7ff",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  inlineTagText: { fontSize: 11, color: "#2f95dc" },
  addTagHint: { fontSize: 12, color: "#bbb" },
  chevron: { fontSize: 24, color: "#ccc", paddingLeft: 8 },

  queueToggle: { paddingHorizontal: 8, paddingVertical: 4 },
  queueDot: { fontSize: 18, color: "#ccc" },
  queueDotActive: { color: "#34c759" },

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
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  modalSubtitle: { fontSize: 14, color: "#888", marginBottom: 16 },
  modalActions: { marginTop: 24, gap: 12 },
  modalSave: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  modalSaveText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  modalCancel: { alignItems: "center", paddingVertical: 8 },
  modalCancelText: { color: "#999", fontSize: 14 },
});

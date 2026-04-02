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
import { getWeekStart } from "../../lib/week";
import TagEditor from "../../components/TagEditor";

type Member = { id: string; display_name: string; role: string };
type Recipe = { id: string; title: string; tags: string[] | null };
type Household = { id: string; name: string; invite_code: string };
type Store = { id: string; name: string; sort_order: number };

export default function HouseholdScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signOut, user } = useAuth();
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set());
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Recipe[]>([]);
  const [searching, setSearching] = useState(false);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [stores, setStores] = useState<Store[]>([]);
  const [storeInput, setStoreInput] = useState("");

  const loadData = useCallback(async () => {
    if (!id) return;

    const [hRes, mRes, rRes, qRes, sRes] = await Promise.all([
      supabase.from("households").select("id, name, invite_code").eq("id", id).single(),
      supabase.from("household_members").select("id, display_name, role").eq("household_id", id),
      supabase.from("recipes").select("id, title, tags").eq("household_id", id).order("created_at", { ascending: false }),
      supabase.from("week_queues").select("recipe_id").eq("household_id", id).eq("week_start", getWeekStart()),
      supabase.from("stores").select("id, name, sort_order").eq("household_id", id).order("sort_order"),
    ]);

    if (hRes.data) setHousehold(hRes.data);
    if (mRes.data) setMembers(mRes.data);
    if (rRes.data) setRecipes(rRes.data);
    if (qRes.data) setQueuedIds(new Set(qRes.data.map((q) => q.recipe_id)));
    if (sRes.data) setStores(sRes.data);
    setLoading(false);
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
    await supabase.from("recipes").update({ tags: editingTags }).eq("id", editingRecipe.id);
    setRecipes((prev) =>
      prev.map((r) => (r.id === editingRecipe.id ? { ...r, tags: editingTags } : r))
    );
    setSavingTags(false);
    setEditingRecipe(null);
  };

  const addStore = async () => {
    const name = storeInput.trim();
    if (!name || !id) return;
    const sort_order = stores.length * 10;
    const { data } = await supabase
      .from("stores")
      .insert({ household_id: id, name, sort_order })
      .select("id, name, sort_order")
      .single();
    if (data) setStores((prev) => [...prev, data]);
    setStoreInput("");
  };

  const deleteStore = async (storeId: string) => {
    setStores((prev) => prev.filter((s) => s.id !== storeId));
    await supabase.from("stores").delete().eq("id", storeId);
  };

  const handleQueueToggle = async (recipe: Recipe) => {
    const weekStart = getWeekStart();
    if (queuedIds.has(recipe.id)) {
      setQueuedIds((prev) => { const next = new Set(prev); next.delete(recipe.id); return next; });
      await supabase
        .from("week_queues")
        .delete()
        .eq("household_id", id)
        .eq("recipe_id", recipe.id)
        .eq("week_start", weekStart);
    } else {
      setQueuedIds((prev) => new Set([...prev, recipe.id]));
      await supabase.from("week_queues").insert({
        household_id: id,
        recipe_id: recipe.id,
        week_start: weekStart,
        added_by: user!.id,
      });
    }
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
    setCollapsedTags((prev) => {
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
      <Text style={styles.householdName}>{household?.name}</Text>

      <View style={styles.inviteBox}>
        <Text style={styles.inviteLabel}>Invite Code</Text>
        <Text style={styles.inviteCode}>{household?.invite_code}</Text>
        <Text style={styles.inviteHint}>Share this code to invite members</Text>
      </View>

      <Text style={styles.sectionTitle}>
        Members ({members.length})
      </Text>
      {members.map((m) => (
        <View key={m.id} style={styles.memberRow}>
          <Text style={styles.memberName}>{m.display_name}</Text>
          <Text style={styles.memberRole}>{m.role}</Text>
        </View>
      ))}

      <View style={styles.storesHeader}>
        <Text style={styles.sectionTitle}>Stores ({stores.length})</Text>
      </View>
      {stores.map((s) => (
        <View key={s.id} style={styles.storeRow}>
          <Text style={styles.storeName}>{s.name}</Text>
          <Pressable onPress={() => deleteStore(s.id)}>
            <Text style={styles.storeDelete}>×</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.storeInputRow}>
        <TextInput
          style={styles.storeInputField}
          placeholder="Add a store…"
          value={storeInput}
          onChangeText={setStoreInput}
          returnKeyType="done"
          onSubmitEditing={addStore}
          autoCapitalize="words"
        />
        <Pressable style={styles.storeAddButton} onPress={addStore}>
          <Text style={styles.storeAddButtonText}>Add</Text>
        </Pressable>
      </View>

      <View style={styles.recipesHeader}>
        <Text style={styles.sectionTitle}>
          Recipes ({recipes.length})
        </Text>
        <View style={styles.recipeActions}>
          <Pressable
            style={[styles.actionButton, styles.weekButton]}
            onPress={() =>
              router.push({
                pathname: "/(app)/week-queue",
                params: { householdId: id },
              })
            }
          >
            <Text style={styles.weekButtonText}>This Week</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.importButton]}
            onPress={() =>
              router.push({
                pathname: "/(app)/import-recipe",
                params: { householdId: id },
              })
            }
          >
            <Text style={styles.importButtonText}>↓ Import</Text>
          </Pressable>
          <Pressable
            style={styles.actionButton}
            onPress={() =>
              router.push({
                pathname: "/(app)/create-recipe",
                params: { householdId: id },
              })
            }
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
          const collapsed = collapsedTags.has(tag);
          return (
            <View key={tag}>
              <Pressable style={styles.tagHeader} onPress={() => toggleTag(tag)}>
                <Text style={styles.tagHeaderText}>{tag} ({sectionRecipes.length})</Text>
                <Text style={styles.tagChevron}>{collapsed ? "›" : "⌄"}</Text>
              </Pressable>
              {!collapsed && sectionRecipes.map((item) => (
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
              <Pressable
                style={styles.modalCancel}
                onPress={() => setEditingRecipe(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  householdName: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
  },
  inviteBox: {
    backgroundColor: "#f0f7ff",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginBottom: 24,
  },
  inviteLabel: {
    fontSize: 12,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  inviteCode: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 4,
    color: "#2f95dc",
    marginVertical: 4,
  },
  inviteHint: {
    fontSize: 12,
    color: "#999",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  memberName: {
    fontSize: 16,
  },
  memberRole: {
    fontSize: 14,
    color: "#999",
  },
  recipesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 24,
    marginBottom: 4,
  },
  recipeActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  importButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2f95dc",
  },
  importButtonText: {
    color: "#2f95dc",
    fontSize: 14,
    fontWeight: "600",
  },
  weekButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#34c759",
  },
  weekButtonText: {
    color: "#34c759",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyText: {
    color: "#999",
    textAlign: "center",
    marginTop: 16,
  },
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
  tagChevron: {
    fontSize: 18,
    color: "#aaa",
  },
  recipeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  recipeTitleArea: {
    flex: 1,
  },
  recipeTitle: {
    fontSize: 16,
  },
  recipeTagsArea: {
    marginTop: 4,
  },
  inlineTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  inlineTag: {
    backgroundColor: "#f0f7ff",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  inlineTagText: {
    fontSize: 11,
    color: "#2f95dc",
  },
  addTagHint: {
    fontSize: 12,
    color: "#bbb",
  },
  chevron: {
    fontSize: 24,
    color: "#ccc",
    paddingLeft: 8,
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
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#888",
    marginBottom: 16,
  },
  modalActions: {
    marginTop: 24,
    gap: 12,
  },
  modalSave: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  modalSaveText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modalCancel: {
    alignItems: "center",
    paddingVertical: 8,
  },
  modalCancelText: {
    color: "#999",
    fontSize: 14,
  },
  storesHeader: {
    marginTop: 24,
    marginBottom: 4,
  },
  storeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  storeName: {
    fontSize: 16,
  },
  storeDelete: {
    fontSize: 20,
    color: "#ccc",
    paddingHorizontal: 4,
  },
  storeInputRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  storeInputField: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: "#fafafa",
  },
  storeAddButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: "center",
  },
  storeAddButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  searchBar: {
    marginBottom: 8,
    marginTop: 4,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fafafa",
  },
  searchSpinner: {
    marginTop: 24,
  },
  queueToggle: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  queueDot: {
    fontSize: 18,
    color: "#ccc",
  },
  queueDotActive: {
    color: "#34c759",
  },
  signOut: {
    marginTop: 32,
    alignSelf: "center",
  },
  signOutText: {
    color: "#999",
    fontSize: 14,
  },
});

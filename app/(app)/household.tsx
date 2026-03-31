import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

type Member = { id: string; display_name: string; role: string };
type Recipe = { id: string; title: string; tags: string[] | null };
type Household = { id: string; name: string; invite_code: string };

export default function HouseholdScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signOut } = useAuth();
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    if (!id) return;

    const [hRes, mRes, rRes] = await Promise.all([
      supabase.from("households").select("id, name, invite_code").eq("id", id).single(),
      supabase.from("household_members").select("id, display_name, role").eq("household_id", id),
      supabase.from("recipes").select("id, title, tags").eq("household_id", id).order("created_at", { ascending: false }),
    ]);

    if (hRes.data) setHousehold(hRes.data);
    if (mRes.data) setMembers(mRes.data);
    if (rRes.data) setRecipes(rRes.data);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

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

      {recipes.length === 0 ? (
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
                <Pressable
                  key={item.id}
                  style={styles.recipeRow}
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/recipe/[id]",
                      params: { id: item.id },
                    })
                  }
                >
                  <Text style={styles.recipeTitle}>{item.title}</Text>
                  <Text style={styles.chevron}>&rsaquo;</Text>
                </Pressable>
              ))}
            </View>
          );
        })
      )}

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
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  recipeTitle: {
    fontSize: 16,
  },
  chevron: {
    fontSize: 24,
    color: "#ccc",
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

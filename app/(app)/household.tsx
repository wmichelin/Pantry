import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

type Member = { id: string; display_name: string; role: string };
type Recipe = { id: string; title: string };
type Household = { id: string; name: string; invite_code: string };

export default function HouseholdScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signOut } = useAuth();
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!id) return;

    const [hRes, mRes, rRes] = await Promise.all([
      supabase.from("households").select("id, name, invite_code").eq("id", id).single(),
      supabase.from("household_members").select("id, display_name, role").eq("household_id", id),
      supabase.from("recipes").select("id, title").eq("household_id", id).order("created_at", { ascending: false }),
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
        <Pressable
          style={styles.addButton}
          onPress={() =>
            router.push({
              pathname: "/(app)/create-recipe",
              params: { householdId: id },
            })
          }
        >
          <Text style={styles.addButtonText}>+ Add Recipe</Text>
        </Pressable>
      </View>

      {recipes.length === 0 ? (
        <Text style={styles.emptyText}>No recipes yet. Add your first one!</Text>
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
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
          )}
        />
      )}

      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
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
    padding: 24,
    backgroundColor: "#fff",
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
    marginBottom: 8,
  },
  addButton: {
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
  emptyText: {
    color: "#999",
    textAlign: "center",
    marginTop: 16,
  },
  recipeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
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

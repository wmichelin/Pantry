import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { getWeekStart } from "../../lib/week";

type IngredientRow = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
};

type RecipeGroup = {
  recipeId: string;
  title: string;
  ingredients: IngredientRow[];
};

export default function ShoppingListScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const [groups, setGroups] = useState<RecipeGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadList();
  }, [householdId]);

  const loadList = async () => {
    const weekStart = getWeekStart();

    const { data: queueData } = await supabase
      .from("week_queues")
      .select("recipe_id, recipes(id, title)")
      .eq("household_id", householdId)
      .eq("week_start", weekStart);

    if (!queueData || queueData.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const recipeIds = queueData.map((q: any) => q.recipe_id);
    const recipeMap = new Map<string, string>(
      queueData.map((q: any) => [q.recipe_id, q.recipes.title])
    );

    const { data: ingredients } = await supabase
      .from("recipe_ingredients")
      .select("id, recipe_id, name, quantity, unit")
      .in("recipe_id", recipeIds);

    const grouped = new Map<string, IngredientRow[]>();
    for (const id of recipeIds) grouped.set(id, []);
    for (const ing of ingredients ?? []) {
      grouped.get(ing.recipe_id)?.push(ing);
    }

    const result: RecipeGroup[] = recipeIds.map((id: string) => ({
      recipeId: id,
      title: recipeMap.get(id) ?? "Unknown Recipe",
      ingredients: grouped.get(id) ?? [],
    }));

    setGroups(result);
    setLoading(false);
  };

  const formatIngredient = (ing: IngredientRow) => {
    const parts: string[] = [];
    if (ing.quantity) parts.push(String(ing.quantity));
    if (ing.unit) parts.push(ing.unit);
    parts.push(ing.name);
    return parts.join(" ");
  };

  const weekStart = getWeekStart();
  const weekLabel = new Date(weekStart + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.weekLabel}>Week of {weekLabel}</Text>

      {groups.length === 0 ? (
        <Text style={styles.emptyText}>No recipes queued for this week.</Text>
      ) : (
        groups.map((group) => (
          <View key={group.recipeId} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            {group.ingredients.length === 0 ? (
              <Text style={styles.noIngredients}>No ingredients on file.</Text>
            ) : (
              group.ingredients.map((ing) => (
                <View key={ing.id} style={styles.ingredientRow}>
                  <Text style={styles.bullet}>{"\u2022"}</Text>
                  <Text style={styles.ingredientText}>{formatIngredient(ing)}</Text>
                </View>
              ))
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 24, paddingBottom: 48 },
  weekLabel: { fontSize: 13, color: "#999", marginBottom: 20 },
  emptyText: { color: "#999", textAlign: "center", marginTop: 32 },
  group: { marginBottom: 28 },
  groupTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#222",
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 6,
  },
  noIngredients: { color: "#bbb", fontSize: 14 },
  ingredientRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  bullet: { color: "#2f95dc", fontSize: 16, marginTop: 1 },
  ingredientText: { flex: 1, fontSize: 15 },
});

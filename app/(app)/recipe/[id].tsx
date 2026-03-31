import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";

type Recipe = { id: string; title: string; created_at: string; source_type: string | null; household_id: string };
type Ingredient = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
};

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    loadRecipe();
  }, [id]);

  const loadRecipe = async () => {
    const [rRes, iRes] = await Promise.all([
      supabase.from("recipes").select("id, title, created_at, source_type, household_id").eq("id", id).single(),
      supabase.from("recipe_ingredients").select("id, name, quantity, unit").eq("recipe_id", id),
    ]);

    if (rRes.data) setRecipe(rRes.data);
    if (iRes.data) setIngredients(iRes.data);
    setLoading(false);
  };

  const handleDelete = async () => {
    await supabase.from("recipe_ingredients").delete().eq("recipe_id", id);
    await supabase.from("recipes").delete().eq("id", id);
    router.replace({ pathname: "/(app)/household", params: { id: recipe!.household_id } });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!recipe) {
    return (
      <View style={styles.center}>
        <Text>Recipe not found.</Text>
      </View>
    );
  }

  const isImported = recipe.source_type === "url" || recipe.source_type === "pinterest_pin";

  const formatIngredient = (ing: Ingredient) => {
    const parts: string[] = [];
    if (ing.quantity) parts.push(String(ing.quantity));
    if (ing.unit) parts.push(ing.unit);
    parts.push(ing.name);
    return parts.join(" ");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{recipe.title}</Text>

      <Text style={styles.sectionTitle}>
        Ingredients ({ingredients.length})
      </Text>

      {ingredients.length === 0 ? (
        <Text style={styles.emptyText}>
          {isImported
            ? "No ingredients were found when this recipe was imported."
            : "No ingredients added yet."}
        </Text>
      ) : (
        ingredients.map((item) => (
          <View key={item.id} style={styles.ingredientRow}>
            <Text style={styles.bullet}>{"\u2022"}</Text>
            <Text style={styles.ingredientText}>
              {formatIngredient(item)}
            </Text>
          </View>
        ))
      )}

      {confirmDelete ? (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>Delete this recipe?</Text>
          <View style={styles.confirmButtons}>
            <Pressable onPress={handleDelete}>
              <Text style={styles.deleteText}>Yes, delete</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmDelete(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.deleteButton} onPress={() => setConfirmDelete(true)}>
          <Text style={styles.deleteText}>Delete Recipe</Text>
        </Pressable>
      )}
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
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  emptyText: {
    color: "#999",
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 6,
    gap: 8,
  },
  bullet: {
    fontSize: 16,
    color: "#2f95dc",
    marginTop: 1,
  },
  ingredientText: {
    fontSize: 16,
    flex: 1,
  },
  deleteButton: {
    marginTop: 40,
    alignSelf: "center",
  },
  deleteText: {
    color: "#ff3b30",
    fontSize: 14,
  },
  confirmRow: {
    marginTop: 40,
    alignItems: "center",
    gap: 12,
  },
  confirmText: {
    fontSize: 14,
    color: "#333",
  },
  confirmButtons: {
    flexDirection: "row",
    gap: 24,
  },
  cancelText: {
    fontSize: 14,
    color: "#999",
  },
});

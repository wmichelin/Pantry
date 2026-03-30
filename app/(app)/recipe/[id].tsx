import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../../lib/supabase";

type Recipe = { id: string; title: string; created_at: string };
type Ingredient = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
};

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecipe();
  }, [id]);

  const loadRecipe = async () => {
    const [rRes, iRes] = await Promise.all([
      supabase.from("recipes").select("id, title, created_at").eq("id", id).single(),
      supabase.from("recipe_ingredients").select("id, name, quantity, unit").eq("recipe_id", id),
    ]);

    if (rRes.data) setRecipe(rRes.data);
    if (iRes.data) setIngredients(iRes.data);
    setLoading(false);
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

  const formatIngredient = (ing: Ingredient) => {
    const parts: string[] = [];
    if (ing.quantity) parts.push(String(ing.quantity));
    if (ing.unit) parts.push(ing.unit);
    parts.push(ing.name);
    return parts.join(" ");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{recipe.title}</Text>

      <Text style={styles.sectionTitle}>
        Ingredients ({ingredients.length})
      </Text>

      {ingredients.length === 0 ? (
        <Text style={styles.emptyText}>No ingredients.</Text>
      ) : (
        <FlatList
          data={ingredients}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.ingredientRow}>
              <Text style={styles.bullet}>{"\u2022"}</Text>
              <Text style={styles.ingredientText}>
                {formatIngredient(item)}
              </Text>
            </View>
          )}
        />
      )}
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
});

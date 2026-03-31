import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Pressable,
  Image,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";

type Recipe = {
  id: string;
  title: string;
  created_at: string;
  source_type: string | null;
  household_id: string;
  source_url: string | null;
  image_url: string | null;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  instructions: string[] | null;
  tags: string[] | null;
};
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
      supabase
        .from("recipes")
        .select("id, title, created_at, source_type, source_url, household_id, image_url, servings, prep_time_minutes, cook_time_minutes, instructions, tags")
        .eq("id", id)
        .single(),
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

  const extractStepText = (step: string): string => {
    try {
      const parsed = JSON.parse(step);
      if (parsed && typeof parsed.text === "string") return parsed.text;
    } catch {}
    const m = step.match(/['"]text['"]\s*:\s*['"](.+)/s);
    if (m) return m[1].replace(/['"]\s*[,}]?\s*$/, "").trim();
    return step;
  };

  const formatIngredient = (ing: Ingredient) => {
    const parts: string[] = [];
    if (ing.quantity) parts.push(String(ing.quantity));
    if (ing.unit) parts.push(ing.unit);
    parts.push(ing.name);
    return parts.join(" ");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {recipe.image_url && (
        <Image source={{ uri: recipe.image_url }} style={styles.image} />
      )}

      <Text style={styles.title}>{recipe.title}</Text>

      {recipe.source_url && (
        <Pressable onPress={() => Linking.openURL(recipe.source_url!)}>
          <Text style={styles.sourceLink}>View original recipe ↗</Text>
        </Pressable>
      )}

      {(recipe.servings || recipe.prep_time_minutes || recipe.cook_time_minutes) && (
        <View style={styles.metaRow}>
          {recipe.servings && (
            <Text style={styles.meta}>🍽 {recipe.servings} servings</Text>
          )}
          {recipe.prep_time_minutes && (
            <Text style={styles.meta}>⏱ {recipe.prep_time_minutes}m prep</Text>
          )}
          {recipe.cook_time_minutes && (
            <Text style={styles.meta}>🔥 {recipe.cook_time_minutes}m cook</Text>
          )}
        </View>
      )}

      {recipe.tags && recipe.tags.length > 0 && (
        <View style={styles.tags}>
          {recipe.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

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
          <View key={item.id} style={styles.row}>
            <Text style={styles.bullet}>{"\u2022"}</Text>
            <Text style={styles.rowText}>{formatIngredient(item)}</Text>
          </View>
        ))
      )}

      {recipe.instructions && recipe.instructions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Instructions</Text>
          {recipe.instructions.map((step, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.stepNumber}>{i + 1}.</Text>
              <Text style={styles.rowText}>{extractStepText(step)}</Text>
            </View>
          ))}
        </>
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
    paddingBottom: 48,
  },
  image: {
    width: "100%",
    height: 220,
    backgroundColor: "#eee",
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  metaRow: {
    flexDirection: "row",
    gap: 16,
    flexWrap: "wrap",
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  meta: {
    fontSize: 14,
    color: "#555",
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  tag: {
    backgroundColor: "#f0f7ff",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: 12,
    color: "#2f95dc",
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    marginTop: 24,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: "#999",
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 24,
    gap: 8,
  },
  bullet: {
    fontSize: 16,
    color: "#2f95dc",
    marginTop: 2,
  },
  stepNumber: {
    fontSize: 15,
    color: "#2f95dc",
    fontWeight: "600",
    marginTop: 2,
    minWidth: 20,
  },
  rowText: {
    fontSize: 15,
    flex: 1,
    lineHeight: 22,
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
  sourceLink: {
    fontSize: 14,
    color: "#2f95dc",
    paddingHorizontal: 24,
    marginBottom: 12,
  },
});

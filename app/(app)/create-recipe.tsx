import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

type Ingredient = { name: string; quantity: string; unit: string };

export default function CreateRecipeScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([
    { name: "", quantity: "", unit: "" },
  ]);
  const [loading, setLoading] = useState(false);

  const updateIngredient = (index: number, field: keyof Ingredient, value: string) => {
    setIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing))
    );
  };

  const addIngredient = () => {
    setIngredients((prev) => [...prev, { name: "", quantity: "", unit: "" }]);
  };

  const removeIngredient = (index: number) => {
    if (ingredients.length <= 1) return;
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert("Missing title", "Give your recipe a name.");
      return;
    }

    const validIngredients = ingredients.filter((i) => i.name.trim());
    if (validIngredients.length === 0) {
      Alert.alert("No ingredients", "Add at least one ingredient.");
      return;
    }

    setLoading(true);

    const { data: recipe, error: recipeError } = await supabase
      .from("recipes")
      .insert({
        title: title.trim(),
        household_id: householdId,
        created_by: user!.id,
      })
      .select()
      .single();

    if (recipeError) {
      setLoading(false);
      Alert.alert("Error", recipeError.message);
      return;
    }

    const ingredientRows = validIngredients.map((i) => ({
      recipe_id: recipe.id,
      name: i.name.trim(),
      quantity: i.quantity ? parseFloat(i.quantity) : null,
      unit: i.unit.trim() || null,
    }));

    const { error: ingError } = await supabase
      .from("recipe_ingredients")
      .insert(ingredientRows);

    setLoading(false);

    if (ingError) {
      Alert.alert("Error saving ingredients", ingError.message);
      return;
    }

    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Recipe Title</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Sheet Pan Chicken Fajitas"
        value={title}
        onChangeText={setTitle}
        autoFocus
      />

      <Text style={[styles.label, { marginTop: 24 }]}>Ingredients</Text>

      {ingredients.map((ing, index) => (
        <View key={index} style={styles.ingredientRow}>
          <TextInput
            style={[styles.input, styles.ingredientName]}
            placeholder="Ingredient"
            value={ing.name}
            onChangeText={(v) => updateIngredient(index, "name", v)}
          />
          <TextInput
            style={[styles.input, styles.ingredientQty]}
            placeholder="Qty"
            value={ing.quantity}
            onChangeText={(v) => updateIngredient(index, "quantity", v)}
            keyboardType="numeric"
          />
          <TextInput
            style={[styles.input, styles.ingredientUnit]}
            placeholder="Unit"
            value={ing.unit}
            onChangeText={(v) => updateIngredient(index, "unit", v)}
          />
          {ingredients.length > 1 && (
            <Pressable
              style={styles.removeButton}
              onPress={() => removeIngredient(index)}
            >
              <Text style={styles.removeButtonText}>x</Text>
            </Pressable>
          )}
        </View>
      ))}

      <Pressable style={styles.addIngredient} onPress={addIngredient}>
        <Text style={styles.addIngredientText}>+ Add Ingredient</Text>
      </Pressable>

      <Pressable
        style={[styles.saveButton, loading && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={loading}
      >
        <Text style={styles.saveButtonText}>
          {loading ? "Saving..." : "Save Recipe"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  ingredientRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    alignItems: "center",
  },
  ingredientName: {
    flex: 3,
  },
  ingredientQty: {
    flex: 1,
  },
  ingredientUnit: {
    flex: 1.5,
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fee",
    justifyContent: "center",
    alignItems: "center",
  },
  removeButtonText: {
    color: "#c00",
    fontWeight: "600",
  },
  addIngredient: {
    paddingVertical: 12,
  },
  addIngredientText: {
    color: "#2f95dc",
    fontSize: 16,
    fontWeight: "600",
  },
  saveButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});

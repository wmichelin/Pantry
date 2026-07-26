import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { showError } from "../../lib/db";
import { IngredientAutocomplete } from "../../components/IngredientAutocomplete";
import {
  ensureCatalogIngredient,
  listCatalogIngredients,
  type CatalogIngredient,
} from "../../lib/ingredient-catalog";

type Ingredient = { name: string; quantity: string; unit: string };

export default function CreateRecipeScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([
    { name: "", quantity: "", unit: "" },
  ]);
  const [catalog, setCatalog] = useState<CatalogIngredient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    listCatalogIngredients(householdId)
      .then(setCatalog)
      .catch((err) => showError("Couldn't load ingredient catalog", err));
  }, [householdId]);

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

    const ingredientRows = validIngredients.map((i) => {
      const qty = parseFloat(i.quantity);
      return {
        recipe_id: recipe.id,
        name: i.name.trim(),
        quantity: i.quantity.trim() && !isNaN(qty) ? qty : null,
        unit: i.unit.trim() || null,
      };
    });

    const { error: ingError } = await supabase
      .from("recipe_ingredients")
      .insert(ingredientRows);

    if (ingError) {
      // Roll back the just-created recipe so we never leave one with no ingredients.
      await supabase.from("recipes").delete().eq("id", recipe.id);
      setLoading(false);
      showError("Couldn't save ingredients", ingError);
      return;
    }

    // Grow the household catalog (separate from recipes) without failing the save.
    try {
      for (const i of validIngredients) {
        await ensureCatalogIngredient(householdId!, i.name);
      }
    } catch (err) {
      console.warn("Catalog upsert after recipe save failed", err);
    }

    setLoading(false);
    router.back();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>Recipe Title</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Sheet Pan Chicken Fajitas"
        value={title}
        onChangeText={setTitle}
        autoFocus
        autoCorrect
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        // Safari ignores autocomplete=off for cardholder-name heuristics; a
        // non-standard token plus an explicit name keeps CC autofill away.
        {...(Platform.OS === "web"
          ? ({
              autoComplete: "nope",
              name: "pantry-recipe-title",
            } as object)
          : null)}
      />

      <Text style={[styles.label, { marginTop: 24 }]}>Ingredients</Text>

      {ingredients.map((ing, index) => (
        <View key={index} style={[styles.ingredientRow, { zIndex: ingredients.length - index }]}>
          <IngredientAutocomplete
            containerStyle={styles.ingredientName}
            style={styles.input}
            placeholder="Ingredient"
            value={ing.name}
            onChangeText={(v) => updateIngredient(index, "name", v)}
            catalog={catalog}
            onSelect={(item) => updateIngredient(index, "name", item.display_name)}
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
    alignItems: "flex-start",
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
    marginTop: 4,
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

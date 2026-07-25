import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  TextInput,
  Alert,
  Modal,
} from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { showError } from "../../lib/db";
import {
  ensureCatalogIngredient,
  listCatalogIngredients,
  seedCatalogFromRecipes,
  type CatalogIngredient,
} from "../../lib/ingredient-catalog";
import { normalizeIngredient } from "../../lib/normalize-ingredient";
import { supabase } from "../../lib/supabase";

export default function IngredientsScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const [items, setItems] = useState<CatalogIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<CatalogIngredient | null>(null);
  const [renameText, setRenameText] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      const list = await listCatalogIngredients(householdId);
      setItems(list);
    } catch (err) {
      showError("Couldn't load ingredients", err);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const addIngredient = async () => {
    if (!householdId || !newName.trim() || adding) return;
    setAdding(true);
    try {
      const row = await ensureCatalogIngredient(householdId, newName);
      if (!row) {
        Alert.alert("Invalid name", "Enter a valid ingredient name.");
        return;
      }
      setNewName("");
      await load();
    } catch (err) {
      showError("Couldn't add ingredient", err);
    } finally {
      setAdding(false);
    }
  };

  const seedFromRecipes = async () => {
    if (!householdId || seeding) return;
    setSeeding(true);
    try {
      const n = await seedCatalogFromRecipes(householdId);
      await load();
      Alert.alert(
        "Seeded from recipes",
        n === 0
          ? "No new names — catalog already has everything from your recipes."
          : `Added ${n} ingredient${n === 1 ? "" : "s"} from recipes.`
      );
    } catch (err) {
      showError("Couldn't seed from recipes", err);
    } finally {
      setSeeding(false);
    }
  };

  const openRename = (item: CatalogIngredient) => {
    setRenaming(item);
    setRenameText(item.display_name);
  };

  const saveRename = async () => {
    if (!renaming || !renameText.trim()) return;
    setSavingRename(true);
    try {
      const { error } = await supabase
        .from("ingredient_metadata")
        .update({ display_name: renameText.trim() })
        .eq("id", renaming.id);
      if (error) throw error;
      setRenaming(null);
      await load();
    } catch (err) {
      showError("Couldn't rename ingredient", err);
    } finally {
      setSavingRename(false);
    }
  };

  const deleteIngredient = (item: CatalogIngredient) => {
    Alert.alert(
      "Remove from catalog?",
      `"${item.display_name}" will leave the ingredients list. Recipes that use this name are unchanged.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("ingredient_metadata")
              .delete()
              .eq("id", item.id);
            if (error) {
              showError("Couldn't remove ingredient", error);
              return;
            }
            setItems((prev) => prev.filter((i) => i.id !== item.id));
          },
        },
      ]
    );
  };

  const filtered = items.filter((i) => {
    const q = normalizeIngredient(filter);
    if (!q) return true;
    return (
      i.normalized_name.includes(q) ||
      i.display_name.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.hint}>
          Household ingredient catalog — used for autocomplete on the shopping
          list and when creating recipes. Separate from your recipe list.
        </Text>

        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder="Add ingredient…"
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={addIngredient}
            returnKeyType="done"
            autoCorrect={false}
            editable={!adding}
          />
          <Pressable
            style={[styles.addButton, (!newName.trim() || adding) && styles.disabled]}
            onPress={addIngredient}
            disabled={!newName.trim() || adding}
          >
            {adding ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.addButtonText}>Add</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          style={[styles.seedButton, seeding && styles.disabled]}
          onPress={seedFromRecipes}
          disabled={seeding}
        >
          <Text style={styles.seedButtonText}>
            {seeding ? "Seeding…" : "Seed from recipes"}
          </Text>
        </Pressable>

        <TextInput
          style={styles.filterInput}
          placeholder="Filter…"
          value={filter}
          onChangeText={setFilter}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />

        <Text style={styles.count}>
          {filtered.length === items.length
            ? `${items.length} ingredient${items.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${items.length}`}
        </Text>

        {filtered.length === 0 ? (
          <Text style={styles.empty}>
            {items.length === 0
              ? "No ingredients yet. Add some, or seed from your recipes."
              : "No matches."}
          </Text>
        ) : (
          filtered.map((item) => (
            <View key={item.id} style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => openRename(item)}>
                <Text style={styles.rowName}>{item.display_name}</Text>
                <Text style={styles.rowMeta}>Tap to rename</Text>
              </Pressable>
              <Pressable
                style={styles.deleteBtn}
                onPress={() => deleteIngredient(item)}
              >
                <Text style={styles.deleteText}>✕</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Modal
        visible={renaming !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename</Text>
            <TextInput
              style={styles.modalInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalSave, savingRename && styles.disabled]}
                onPress={saveRename}
                disabled={savingRename || !renameText.trim()}
              >
                {savingRename ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalSaveText}>Save</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setRenaming(null)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 48 },
  hint: { fontSize: 13, color: "#888", lineHeight: 18, marginBottom: 16 },
  addRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
    minWidth: 64,
    alignItems: "center",
  },
  addButtonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  seedButton: {
    borderWidth: 1,
    borderColor: "#2f95dc",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 16,
  },
  seedButtonText: { color: "#2f95dc", fontWeight: "600", fontSize: 14 },
  filterInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 8,
    backgroundColor: "#fafafa",
  },
  count: { fontSize: 12, color: "#999", marginBottom: 8, fontWeight: "600" },
  empty: { color: "#999", textAlign: "center", marginTop: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#f2f2f2",
    paddingVertical: 12,
  },
  rowMain: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: "600", color: "#222" },
  rowMeta: { fontSize: 12, color: "#aaa", marginTop: 2 },
  deleteBtn: { paddingHorizontal: 12, paddingVertical: 4 },
  deleteText: { color: "#ff3b30", fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  modalActions: { gap: 12 },
  modalSave: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  modalSaveText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  modalCancel: { textAlign: "center", color: "#999", paddingVertical: 8 },
});

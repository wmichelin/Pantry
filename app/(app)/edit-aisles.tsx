import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import {
  useLocalSearchParams,
  useFocusEffect,
  useNavigation,
  useRouter,
} from "expo-router";
import { showError } from "../../lib/db";
import { SortableList } from "../../components/SortableList";
import {
  DEFAULT_INGREDIENT_CATEGORY,
  type IngredientCategory,
} from "../../lib/ingredient-categories";
import {
  createHouseholdAisle,
  deleteHouseholdAisle,
  listHouseholdAisles,
  saveHouseholdAisleOrder,
} from "../../lib/household-aisles";

export default function EditAislesScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const navigation = useNavigation();
  const router = useRouter();

  const [aisleCategories, setAisleCategories] = useState<IngredientCategory[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          onPress={() => {
            if (householdId) {
              router.replace({
                pathname: "/(app)/household",
                params: { id: householdId },
              });
              return;
            }
            if (router.canGoBack()) router.back();
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Back to household"
        >
          <Text style={{ color: "#2f95dc", fontSize: 16, fontWeight: "600" }}>
            ‹ Back
          </Text>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          onPress={() => {
            if (!householdId) return;
            router.push({
              pathname: "/(app)/shopping-list",
              params: { householdId },
            });
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Shopping list"
        >
          <Text style={{ color: "#2f95dc", fontSize: 16, fontWeight: "600" }}>
            List ›
          </Text>
        </Pressable>
      ),
    });
  }, [householdId, navigation, router]);

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      const aisles = await listHouseholdAisles(householdId);
      setAisleCategories(aisles);
    } catch (err) {
      showError("Couldn't load aisle order", err);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const saveAisleOrder = async (ordered: IngredientCategory[]) => {
    if (!householdId) return;
    setSaving(true);
    const previous = aisleCategories;
    setAisleCategories(ordered);
    try {
      await saveHouseholdAisleOrder(householdId, ordered);
      const refreshed = await listHouseholdAisles(householdId);
      setAisleCategories(refreshed);
    } catch (err) {
      setAisleCategories(previous);
      showError("Couldn't save aisle order", err);
    } finally {
      setSaving(false);
    }
  };

  const addAisle = async () => {
    if (!householdId || !newLabel.trim() || adding) return;
    setAdding(true);
    try {
      await createHouseholdAisle(householdId, newLabel);
      setNewLabel("");
      setAisleCategories(await listHouseholdAisles(householdId));
    } catch (err) {
      showError("Couldn't add aisle", err);
    } finally {
      setAdding(false);
    }
  };

  const confirmDelete = (aisle: IngredientCategory) => {
    if (aisle.id === DEFAULT_INGREDIENT_CATEGORY) return;
    Alert.alert(
      "Delete aisle?",
      `Ingredients in "${aisle.label}" will move to Other.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void deleteAisle(aisle.id),
        },
      ]
    );
  };

  const deleteAisle = async (key: string) => {
    if (!householdId) return;
    const previous = aisleCategories;
    setAisleCategories((prev) => prev.filter((a) => a.id !== key));
    try {
      await deleteHouseholdAisle(householdId, key);
      setAisleCategories(await listHouseholdAisles(householdId));
    } catch (err) {
      setAisleCategories(previous);
      showError("Couldn't delete aisle", err);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Aisle order ({aisleCategories.length})
        </Text>
        {saving ? <ActivityIndicator size="small" color="#2f95dc" /> : null}
      </View>
      <Text style={styles.hint}>
        Drag to match your store walk path. Delete moves ingredients to Other.
      </Text>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder="New aisle name…"
          value={newLabel}
          onChangeText={setNewLabel}
          onSubmitEditing={() => void addAisle()}
          returnKeyType="done"
          autoCorrect={false}
          editable={!adding}
        />
        <Pressable
          style={[styles.addButton, (!newLabel.trim() || adding) && styles.disabled]}
          onPress={() => void addAisle()}
          disabled={!newLabel.trim() || adding}
        >
          {adding ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.addButtonText}>Add</Text>
          )}
        </Pressable>
      </View>

      <SortableList
        items={aisleCategories}
        keyExtractor={(item) => item.id}
        onReorder={(next) => {
          void saveAisleOrder(next);
        }}
        renderItem={(item, drag, isActive) => {
          const canDelete = item.id !== DEFAULT_INGREDIENT_CATEGORY;
          return (
            <View style={[styles.row, isActive && styles.rowActive]}>
              {drag ? (
                <Pressable style={styles.dragHit} onPressIn={drag}>
                  <Text style={styles.label}>{item.label}</Text>
                </Pressable>
              ) : (
                <Text style={styles.label}>{item.label}</Text>
              )}
              {canDelete ? (
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => confirmDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.label}`}
                >
                  <Text style={styles.deleteText}>✕</Text>
                </Pressable>
              ) : (
                <Text style={styles.otherBadge}>Required</Text>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff", paddingHorizontal: 24 },
  header: {
    marginTop: 16,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: "600", flex: 1 },
  hint: { fontSize: 13, color: "#999", marginTop: 4, marginBottom: 12 },
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
  disabled: { opacity: 0.6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
  },
  rowActive: { backgroundColor: "#f0f7ff" },
  dragHit: { flex: 1 },
  label: { flex: 1, fontSize: 16 },
  deleteBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  deleteText: { color: "#ff3b30", fontSize: 16, fontWeight: "600" },
  otherBadge: { fontSize: 12, color: "#999", paddingHorizontal: 8 },
});

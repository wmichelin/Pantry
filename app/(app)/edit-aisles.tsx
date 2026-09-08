import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
} from "react-native";
import {
  useLocalSearchParams,
  useFocusEffect,
  useNavigation,
  useRouter,
} from "expo-router";
import { errorMessage } from "../../lib/db";
import { activeCatalogSettingsAPI } from "../../lib/active-catalog-settings";
import { ConfirmAction } from "../../components/ConfirmAction";
import { useSettingsOperation } from "../../lib/use-settings-operation";
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
  return <HouseholdAisles key={householdId} householdId={householdId} />;
}

function HouseholdAisles({ householdId }: { householdId: string }) {
  const navigation = useNavigation();
  const router = useRouter();

  const [aisleCategories, setAisleCategories] = useState<IngredientCategory[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<IngredientCategory | null>(null);
  const operation = useSettingsOperation();
  const { pending, epoch, busy } = operation;

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

  const load = useCallback(async (duringMutation = false) => {
    if (!householdId || (pending.current && !duringMutation)) return;
    const version = ++epoch.current;
    try {
      const api = await activeCatalogSettingsAPI();
      const view = api ? await api.aisles(householdId) : { aisles: await listHouseholdAisles(householdId), revision: "" };
      if (version !== epoch.current) return;
      setAisleCategories(view.aisles);
      setRevision(view.revision);
    } catch (err) {
      if (version === epoch.current) setNotice(`Couldn't load aisle order: ${errorMessage(err)}`);
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }, [householdId, pending, epoch]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const saveAisleOrder = async (ordered: IngredientCategory[]) => {
    if (!householdId || !operation.begin()) return;
    setNotice("");
    setSaving(true);
    const previous = aisleCategories;
    setAisleCategories(ordered);
    try {
      const api = await activeCatalogSettingsAPI();
      if (api) {
        const view = await api.orderAisles(householdId, revision, ordered.map(a => a.id));
        setAisleCategories(view.aisles);
        setRevision(view.revision);
      } else {
        await saveHouseholdAisleOrder(householdId, ordered);
        await load(true);
      }
    } catch (err) {
      setAisleCategories(previous);
      setNotice(`Couldn't save aisle order: ${errorMessage(err)}`);
      await load(true);
    } finally {
      setSaving(false);
      operation.end();
    }
  };

  const addAisle = async () => {
    if (!householdId || !newLabel.trim() || !operation.begin()) return;
    setNotice("");
    setAdding(true);
    try {
      const api = await activeCatalogSettingsAPI();
      if (api) {
        const view = await api.addAisle(householdId, newLabel);
        setAisleCategories(view.aisles);
        setRevision(view.revision);
      } else {
        await createHouseholdAisle(householdId, newLabel);
        await load(true);
      }
      setNewLabel("");
    } catch (err) {
      setNotice(`Couldn't add aisle: ${errorMessage(err)}`);
    } finally {
      setAdding(false);
      operation.end();
    }
  };

  const confirmDelete = (aisle: IngredientCategory) => {
    if (aisle.id === DEFAULT_INGREDIENT_CATEGORY || pending.current) return;
    setNotice("");
    setRemoving(aisle);
  };

  const deleteAisle = async (key: string) => {
    if (!householdId || !operation.begin()) return;
    setNotice("");
    try {
      const api = await activeCatalogSettingsAPI();
      if (api) {
        const view = await api.removeAisle(householdId, key);
        setAisleCategories(view.aisles);
        setRevision(view.revision);
      } else {
        await deleteHouseholdAisle(householdId, key);
        await load(true);
      }
      setRemoving(null);
    } catch (err) {
      setNotice(`Couldn't delete aisle: ${errorMessage(err)}`);
    } finally {
      operation.end();
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
      {notice ? <Text accessibilityRole="alert" style={{ color: "#b42318", marginBottom: 12 }}>{notice}</Text> : null}

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder="New aisle name…"
          value={newLabel}
          onChangeText={setNewLabel}
          onSubmitEditing={() => void addAisle()}
          returnKeyType="done"
          autoCorrect={false}
          editable={!busy}
        />
        <Pressable
          style={[styles.addButton, (!newLabel.trim() || busy) && styles.disabled]}
          onPress={() => void addAisle()}
          disabled={!newLabel.trim() || busy}
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
        isDraggable={(item) => !busy && item.id !== DEFAULT_INGREDIENT_CATEGORY}
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
                  disabled={busy}
                  {...({ dataSet: { noDrag: "true" } } as object)}
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
      <ConfirmAction visible={!!removing} title="Delete aisle?" message={`Ingredients in "${removing?.label ?? ""}" will move to Other.${notice ? `\n\n${notice}` : ""}`} confirmLabel="Delete" busy={busy} onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) void deleteAisle(removing.id); }} />
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

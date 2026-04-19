import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Modal,
} from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { SortableList } from "../../components/SortableList";
import { supabase } from "../../lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Store = { id: string; name: string; sort_order: number };

type ConsolidatedItem = {
  normalizedName: string;
  metadataId: string;
  sortOrder: number;
  storeIds: string[];
  occurrences: { recipeTitle: string; quantity: number | null; unit: string | null }[];
  checked: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalize = (name: string) => name.toLowerCase().trim();

const formatQty = (quantity: number | null, unit: string | null): string => {
  const parts: string[] = [];
  if (quantity) parts.push(String(quantity));
  if (unit) parts.push(unit);
  return parts.join(" ");
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ShoppingListScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const navigation = useNavigation();

  const [items, setItems] = useState<ConsolidatedItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [assigningItem, setAssigningItem] = useState<ConsolidatedItem | null>(null);
  const [pendingStoreIds, setPendingStoreIds] = useState<string[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);

  // ── Header buttons ──────────────────────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            if (editMode) saveOrder();
            setEditMode((e) => !e);
          }}
          style={{ paddingHorizontal: 16 }}
        >
          <Text style={{ color: "#2f95dc", fontSize: 16, fontWeight: "600" }}>
            {editMode ? "Done" : "Edit Order"}
          </Text>
        </Pressable>
      ),
    });
  }, [editMode, items]);

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    if (!householdId) return;

    const [queueRes, storesRes, checksRes] = await Promise.all([
      supabase
        .from("week_queues")
        .select("recipe_id, recipes(id, title)")
        .eq("household_id", householdId),
      supabase
        .from("stores")
        .select("id, name, sort_order")
        .eq("household_id", householdId)
        .order("sort_order"),
      supabase
        .from("shopping_list_checks")
        .select("normalized_name")
        .eq("household_id", householdId),
    ]);

    setStores(storesRes.data ?? []);
    const checkedNames = new Set((checksRes.data ?? []).map((c) => c.normalized_name));

    const queueData = queueRes.data ?? [];
    if (queueData.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    const recipeIds = queueData.map((q: any) => q.recipe_id);
    const recipeTitle = new Map<string, string>(
      queueData.map((q: any) => [q.recipe_id, (q.recipes as any)?.title ?? "Unknown"])
    );

    const [ingredientsRes, metaRes, availRes] = await Promise.all([
      supabase
        .from("recipe_ingredients")
        .select("id, recipe_id, name, quantity, unit")
        .in("recipe_id", recipeIds),
      supabase
        .from("ingredient_metadata")
        .select("id, normalized_name, sort_order")
        .eq("household_id", householdId),
      supabase
        .from("ingredient_store_availability")
        .select("ingredient_metadata_id, store_id"),
    ]);

    const metaByName = new Map(
      (metaRes.data ?? []).map((m) => [m.normalized_name, m])
    );
    const availByMetaId = new Map<string, string[]>();
    for (const a of availRes.data ?? []) {
      const list = availByMetaId.get(a.ingredient_metadata_id) ?? [];
      list.push(a.store_id);
      availByMetaId.set(a.ingredient_metadata_id, list);
    }

    // Group recipe_ingredients by normalized name
    const grouped = new Map<string, ConsolidatedItem>();
    for (const ing of ingredientsRes.data ?? []) {
      const key = normalize(ing.name);
      // Skip section headers that slipped through import (e.g. "for the salad:")
      if (key.endsWith(":")) continue;
      const meta = metaByName.get(key);
      const existing = grouped.get(key);
      if (existing) {
        existing.occurrences.push({
          recipeTitle: recipeTitle.get(ing.recipe_id) ?? "Unknown",
          quantity: ing.quantity,
          unit: ing.unit,
        });
      } else {
        grouped.set(key, {
          normalizedName: key,
          metadataId: meta?.id ?? "",
          sortOrder: meta?.sort_order ?? Infinity,
          storeIds: meta ? (availByMetaId.get(meta.id) ?? []) : [],
          occurrences: [{
            recipeTitle: recipeTitle.get(ing.recipe_id) ?? "Unknown",
            quantity: ing.quantity,
            unit: ing.unit,
          }],
          checked: checkedNames.has(key),
        });
      }
    }

    // Auto-create ingredient_metadata for new normalized names
    const newNames = [...grouped.keys()].filter((k) => !metaByName.has(k));
    if (newNames.length > 0) {
      const maxOrder = Math.max(0, ...(metaRes.data ?? []).map((m) => m.sort_order));
      const inserts = newNames.map((name, i) => ({
        household_id: householdId,
        normalized_name: name,
        sort_order: maxOrder + (i + 1) * 10,
      }));
      const { data: newMeta } = await supabase
        .from("ingredient_metadata")
        .upsert(inserts, { onConflict: "household_id,normalized_name", ignoreDuplicates: true })
        .select("id, normalized_name, sort_order");
      for (const m of newMeta ?? []) {
        const item = grouped.get(m.normalized_name);
        if (item) {
          item.metadataId = m.id;
          item.sortOrder = m.sort_order;
        }
      }
    }

    const sorted = [...grouped.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    setItems(sorted);
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // ── Check-off ───────────────────────────────────────────────────────────────
  const toggleCheck = async (item: ConsolidatedItem) => {
    const nowChecked = !item.checked;
    setItems((prev) =>
      prev.map((i) => i.normalizedName === item.normalizedName ? { ...i, checked: nowChecked } : i)
    );
    if (nowChecked) {
      await supabase.from("shopping_list_checks").upsert({
        household_id: householdId,
        normalized_name: item.normalizedName,
      }, { onConflict: "household_id,normalized_name", ignoreDuplicates: true });
    } else {
      await supabase
        .from("shopping_list_checks")
        .delete()
        .eq("household_id", householdId)
        .eq("normalized_name", item.normalizedName);
    }
  };

  // ── Clear checks ────────────────────────────────────────────────────────────
  const clearChecks = async () => {
    await supabase.from("shopping_list_checks").delete().eq("household_id", householdId);
    setItems((prev) => prev.map((i) => ({ ...i, checked: false })));
  };

  // ── Reorder / save order ─────────────────────────────────────────────────────
  const saveOrder = async () => {
    const updates = items.map((item, i) => ({
      id: item.metadataId,
      household_id: householdId,
      normalized_name: item.normalizedName,
      sort_order: (i + 1) * 10,
    }));
    await supabase.from("ingredient_metadata").upsert(updates, { onConflict: "id" });
    setItems((prev) => prev.map((item, i) => ({ ...item, sortOrder: (i + 1) * 10 })));
  };

  // ── Store assignment ─────────────────────────────────────────────────────────
  const openAssign = (item: ConsolidatedItem) => {
    setAssigningItem(item);
    setPendingStoreIds([...item.storeIds]);
  };

  const saveAssignment = async () => {
    if (!assigningItem) return;
    setSavingAssignment(true);
    await supabase
      .from("ingredient_store_availability")
      .delete()
      .eq("ingredient_metadata_id", assigningItem.metadataId);
    if (pendingStoreIds.length > 0) {
      await supabase.from("ingredient_store_availability").insert(
        pendingStoreIds.map((storeId) => ({
          ingredient_metadata_id: assigningItem.metadataId,
          store_id: storeId,
        }))
      );
    }
    setItems((prev) =>
      prev.map((i) =>
        i.normalizedName === assigningItem.normalizedName
          ? { ...i, storeIds: pendingStoreIds }
          : i
      )
    );
    setSavingAssignment(false);
    setAssigningItem(null);
  };

  // ── Render helpers ──────────────────────────────────────────────────────────
  const renderItemRow = (
    item: ConsolidatedItem,
    drag?: () => void,
    isActive?: boolean
  ) => {
    const storeLabel =
      item.storeIds.length === 0
        ? null
        : item.storeIds
            .map((sid) => stores.find((s) => s.id === sid)?.name ?? "")
            .filter(Boolean)
            .map((n) => n.slice(0, 3).toUpperCase())
            .join(" · ");

    return (
      <View style={[styles.itemRow, item.checked && styles.itemRowChecked, isActive && styles.itemRowActive]}>
        {editMode && (
          <Pressable onPressIn={drag} style={styles.dragHandle}>
            <Text style={styles.dragHandleIcon}>≡</Text>
          </Pressable>
        )}
        <Pressable style={styles.checkbox} onPress={() => !editMode && toggleCheck(item)}>
          <Text style={[styles.checkboxIcon, item.checked && styles.checkboxIconChecked]}>
            {item.checked ? "●" : "○"}
          </Text>
        </Pressable>
        <View style={styles.itemContent}>
          <Text style={[styles.itemName, item.checked && styles.itemNameChecked]}>
            {item.normalizedName.replace(/\b\w/g, (c) => c.toUpperCase())}
          </Text>
          {item.occurrences.map((occ, i) => {
            const qty = formatQty(occ.quantity, occ.unit);
            return (
              <Text key={i} style={[styles.occurrence, item.checked && styles.occurrenceChecked]}>
                {qty ? `${qty} · ` : ""}{occ.recipeTitle}
              </Text>
            );
          })}
        </View>
        {!editMode && stores.length > 0 && (
          <Pressable style={styles.storeBadge} onPress={() => openAssign(item)}>
            <Text style={styles.storeBadgeText}>{storeLabel ?? "+"}</Text>
          </Pressable>
        )}
      </View>
    );
  };

  // ── Build sections ──────────────────────────────────────────────────────────
  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  const renderSection = (sectionItems: ConsolidatedItem[], checkedItems: ConsolidatedItem[], label: string) => {
    if (sectionItems.length === 0 && checkedItems.length === 0) return null;
    return (
      <View key={label}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{label}</Text>
        </View>
        {sectionItems.map((item) => (
          <View key={item.normalizedName}>{renderItemRow(item)}</View>
        ))}
        {checkedItems.map((item) => (
          <View key={item.normalizedName}>{renderItemRow(item)}</View>
        ))}
      </View>
    );
  };

  // ── Loading / empty ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // ── Edit mode: flat reorderable list ─────────────────────────────────────────
  if (editMode) {
    return (
      <View style={styles.container}>
        <View style={styles.editBanner}>
          <Text style={styles.editBannerText}>Drag to reorder. Tap Done to save.</Text>
        </View>
        <SortableList
          items={items}
          keyExtractor={(item) => item.normalizedName}
          renderItem={(item, drag, isActive) => renderItemRow(item, drag, isActive)}
          onReorder={(data) => setItems(data)}
        />
      </View>
    );
  }

  // ── Normal view ─────────────────────────────────────────────────────────────
  const body =
    items.length === 0 ? (
      <Text style={styles.emptyText}>No recipes queued. Add some from the queue!</Text>
    ) : stores.length === 0 ? (
      // Flat list (no stores configured)
      <>
        {unchecked.map((item) => (
          <View key={item.normalizedName}>{renderItemRow(item)}</View>
        ))}
        {checked.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Got it</Text>
            </View>
            {checked.map((item) => (
              <View key={item.normalizedName}>{renderItemRow(item)}</View>
            ))}
          </>
        )}
      </>
    ) : (
      // Store sections
      <>
        {stores.map((store) => {
          const storeUnchecked = unchecked.filter((i) => i.storeIds.includes(store.id));
          const storeChecked = checked.filter((i) => i.storeIds.includes(store.id));
          return renderSection(storeUnchecked, storeChecked, store.name);
        })}
        {renderSection(
          unchecked.filter((i) => i.storeIds.length === 0),
          checked.filter((i) => i.storeIds.length === 0),
          "Other"
        )}
      </>
    );

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {checked.length > 0 && (
          <Pressable style={styles.clearChecksRow} onPress={clearChecks}>
            <Text style={styles.clearChecksText}>Clear checks</Text>
          </Pressable>
        )}
        {body}
      </ScrollView>

      {/* Store assignment modal */}
      <Modal
        visible={assigningItem !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setAssigningItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {assigningItem?.normalizedName.replace(/\b\w/g, (c) => c.toUpperCase())}
            </Text>
            <Text style={styles.modalSubtitle}>Where can you get this?</Text>
            {stores.map((store) => {
              const selected = pendingStoreIds.includes(store.id);
              return (
                <Pressable
                  key={store.id}
                  style={styles.storeOption}
                  onPress={() =>
                    setPendingStoreIds((prev) =>
                      selected ? prev.filter((id) => id !== store.id) : [...prev, store.id]
                    )
                  }
                >
                  <Text style={styles.storeOptionCheck}>{selected ? "☑" : "☐"}</Text>
                  <Text style={styles.storeOptionName}>{store.name}</Text>
                </Pressable>
              );
            })}
            <View style={styles.modalDivider} />
            <Pressable
              style={styles.storeOption}
              onPress={() => setPendingStoreIds([])}
            >
              <Text style={styles.storeOptionCheck}>{pendingStoreIds.length === 0 ? "☑" : "☐"}</Text>
              <Text style={styles.storeOptionName}>Any Store</Text>
            </Pressable>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalSave, savingAssignment && styles.buttonDisabled]}
                onPress={saveAssignment}
                disabled={savingAssignment}
              >
                {savingAssignment ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalSaveText}>Save</Text>
                )}
              </Pressable>
              <Pressable style={styles.modalCancel} onPress={() => setAssigningItem(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { paddingBottom: 48 },
  clearChecksRow: { alignItems: "flex-end", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  clearChecksText: { fontSize: 13, color: "#ff3b30", fontWeight: "600" },
  emptyText: { color: "#999", textAlign: "center", marginTop: 32 },

  sectionHeader: {
    backgroundColor: "#f8f8f8",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e8e8e8",
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f2f2",
    backgroundColor: "#fff",
  },
  itemRowChecked: { opacity: 0.45 },
  itemRowActive: { backgroundColor: "#f0f7ff", elevation: 4 },

  dragHandle: {
    paddingRight: 10,
    paddingTop: 2,
    justifyContent: "center",
  },
  dragHandleIcon: {
    fontSize: 20,
    color: "#bbb",
  },

  checkbox: { paddingRight: 10, paddingTop: 2 },
  checkboxIcon: { fontSize: 18, color: "#ccc" },
  checkboxIconChecked: { color: "#34c759" },

  itemContent: { flex: 1 },
  itemName: { fontSize: 16, fontWeight: "600", color: "#222", marginBottom: 2 },
  itemNameChecked: { textDecorationLine: "line-through", color: "#999" },
  occurrence: { fontSize: 13, color: "#888", lineHeight: 18 },
  occurrenceChecked: { textDecorationLine: "line-through" },

  storeBadge: {
    marginLeft: 8,
    marginTop: 2,
    backgroundColor: "#f0f7ff",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: "center",
  },
  storeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#2f95dc",
    letterSpacing: 0.3,
  },

  editBanner: {
    backgroundColor: "#f0f7ff",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#d0e8f8",
  },
  editBannerText: {
    fontSize: 13,
    color: "#2f95dc",
    textAlign: "center",
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#888",
    marginBottom: 16,
  },
  storeOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  storeOptionCheck: { fontSize: 20, color: "#2f95dc" },
  storeOptionName: { fontSize: 16 },
  modalDivider: {
    height: 1,
    backgroundColor: "#eee",
    marginVertical: 4,
  },
  modalActions: {
    marginTop: 20,
    gap: 12,
  },
  modalSave: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  modalSaveText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  modalCancel: { alignItems: "center", paddingVertical: 8 },
  modalCancelText: { color: "#999", fontSize: 14 },
});

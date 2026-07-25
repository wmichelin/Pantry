import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Modal,
  Share,
  Alert,
  Platform,
  TextInput,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import { useLocalSearchParams, useNavigation, useFocusEffect } from "expo-router";
import { SortableList } from "../../components/SortableList";
import { IngredientAutocomplete } from "../../components/IngredientAutocomplete";
import { supabase } from "../../lib/supabase";
import { showError, throwOnError } from "../../lib/db";
import { formatShoppingList } from "../../lib/format-shopping-list";
import { formatQuantity } from "../../lib/format-quantity";
import {
  ensureCatalogIngredient,
  listCatalogIngredients,
  type CatalogIngredient,
} from "../../lib/ingredient-catalog";
import {
  normalizeIngredient,
  titleCaseIngredient,
} from "../../lib/normalize-ingredient";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsolidatedItem = {
  normalizedName: string;
  displayName: string;
  metadataId: string;
  sortOrder: number;
  occurrences: { recipeTitle: string; quantity: number | null; unit: string | null }[];
  checked: boolean;
  isManual: boolean;
  manualItemId?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatQty = (quantity: number | null, unit: string | null): string => {
  const parts: string[] = [];
  if (quantity) parts.push(formatQuantity(quantity));
  if (unit) parts.push(unit);
  return parts.join(" ");
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ShoppingListScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const navigation = useNavigation();

  const [items, setItems] = useState<ConsolidatedItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const addInputRef = useRef<TextInput>(null);
  const [clearingWeek, setClearingWeek] = useState(false);
  const [clearWeekModalVisible, setClearWeekModalVisible] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    if (!householdId) return;

    try {
      const [queueRes, checksRes, manualRes, catalogList] = await Promise.all([
        supabase
          .from("week_queues")
          .select("recipe_id, recipes(id, title)")
          .eq("household_id", householdId),
        supabase
          .from("shopping_list_checks")
          .select("normalized_name")
          .eq("household_id", householdId),
        supabase
          .from("shopping_list_manual_items")
          .select("id, normalized_name, quantity, unit")
          .eq("household_id", householdId),
        listCatalogIngredients(householdId),
      ]);

      if (queueRes.error) throw queueRes.error;
      if (checksRes.error) throw checksRes.error;
      if (manualRes.error) throw manualRes.error;

      setCatalog(catalogList);
      const checkedNames = new Set((checksRes.data ?? []).map((c) => c.normalized_name));
      const queueData = queueRes.data ?? [];
      const manualItems = manualRes.data ?? [];

      const recipeIds = queueData.map((q: any) => q.recipe_id);
      const recipeTitle = new Map<string, string>(
        queueData.map((q: any) => [q.recipe_id, (q.recipes as any)?.title ?? "Unknown"])
      );

      const [ingredientsRes, metaRes] = await Promise.all([
        recipeIds.length > 0
          ? supabase
              .from("recipe_ingredients")
              .select("id, recipe_id, name, quantity, unit")
              .in("recipe_id", recipeIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        supabase
          .from("ingredient_metadata")
          .select("id, normalized_name, display_name, sort_order")
          .eq("household_id", householdId),
      ]);

      if (ingredientsRes.error) throw ingredientsRes.error;
      if (metaRes.error) throw metaRes.error;

      const metaByName = new Map(
        (metaRes.data ?? []).map((m) => [m.normalized_name, m])
      );

      const grouped = new Map<string, ConsolidatedItem>();

      for (const ing of ingredientsRes.data ?? []) {
        const key = normalizeIngredient(ing.name);
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
            displayName: meta?.display_name ?? titleCaseIngredient(key),
            metadataId: meta?.id ?? "",
            sortOrder: meta?.sort_order ?? Infinity,
            occurrences: [{
              recipeTitle: recipeTitle.get(ing.recipe_id) ?? "Unknown",
              quantity: ing.quantity,
              unit: ing.unit,
            }],
            checked: checkedNames.has(key),
            isManual: false,
          });
        }
      }

      for (const manual of manualItems) {
        const key = manual.normalized_name;
        const existing = grouped.get(key);
        if (existing) {
          existing.isManual = true;
          existing.manualItemId = manual.id;
        } else {
          const meta = metaByName.get(key);
          const hasQty = manual.quantity != null || !!manual.unit;
          grouped.set(key, {
            normalizedName: key,
            displayName: meta?.display_name ?? titleCaseIngredient(key),
            metadataId: meta?.id ?? "",
            sortOrder: meta?.sort_order ?? Infinity,
            occurrences: hasQty
              ? [{
                  recipeTitle: "Added",
                  quantity: manual.quantity,
                  unit: manual.unit,
                }]
              : [],
            checked: checkedNames.has(key),
            isManual: true,
            manualItemId: manual.id,
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
          display_name: titleCaseIngredient(name),
          sort_order: maxOrder + (i + 1) * 10,
        }));
        const { data: newMeta, error: upsertError } = await supabase
          .from("ingredient_metadata")
          .upsert(inserts, { onConflict: "household_id,normalized_name", ignoreDuplicates: true })
          .select("id, normalized_name, display_name, sort_order");
        if (upsertError) throw upsertError;
        for (const m of newMeta ?? []) {
          const item = grouped.get(m.normalized_name);
          if (item) {
            item.metadataId = m.id;
            item.sortOrder = m.sort_order;
            item.displayName = m.display_name;
          }
        }
        setCatalog(await listCatalogIngredients(householdId));
      }

      const sorted = [...grouped.values()].sort((a, b) => a.sortOrder - b.sortOrder);
      setItems(sorted);
    } catch (err) {
      showError("Couldn't load the shopping list", err);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      loadList();
    }, [loadList])
  );

  const exportText = useCallback(
    () =>
      formatShoppingList(
        items.map((i) => ({
          normalizedName: i.displayName,
          checked: i.checked,
          storeIds: [],
          occurrences: i.occurrences,
        }))
      ),
    [items]
  );

  const shareList = useCallback(async () => {
    const message = exportText();
    if (!message) return;
    try {
      // Share a .md file so Apple Notes can Import Markdown → interactive checklists.
      // Plain ☐/☑ (and even pasted Markdown on older iOS) stay as dead text in Notes.
      if (Platform.OS === "ios" || Platform.OS === "android") {
        const file = new File(Paths.cache, "Shopping List.md");
        file.create({ overwrite: true });
        file.write(message);
        await Share.share(
          Platform.OS === "ios"
            ? { url: file.uri }
            : { message, url: file.uri, title: "Shopping List.md" }
        );
        return;
      }
      await Share.share({ message });
    } catch (err) {
      showError("Couldn't share the list", err);
    }
  }, [exportText]);

  const copyList = useCallback(async () => {
    const message = exportText();
    if (!message) return;
    try {
      await Clipboard.setStringAsync(message);
      Alert.alert("Copied", "Markdown checklist copied to clipboard.");
    } catch (err) {
      showError("Couldn't copy the list", err);
    }
  }, [exportText]);

  // ── Header buttons ──────────────────────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {!editMode && items.length > 0 && (
            <>
              <Pressable onPress={copyList} style={{ paddingHorizontal: 10 }}>
                <Text style={{ color: "#2f95dc", fontSize: 16, fontWeight: "600" }}>
                  Copy
                </Text>
              </Pressable>
              <Pressable onPress={shareList} style={{ paddingHorizontal: 10 }}>
                <Text style={{ color: "#2f95dc", fontSize: 16, fontWeight: "600" }}>
                  Share
                </Text>
              </Pressable>
            </>
          )}
          <Pressable
            onPress={() => {
              if (editMode) saveOrder();
              setEditMode((e) => !e);
            }}
            style={{ paddingHorizontal: 16 }}
          >
            <Text style={{ color: "#2f95dc", fontSize: 16, fontWeight: "600" }}>
              {editMode ? "Done" : "Edit"}
            </Text>
          </Pressable>
        </View>
      ),
    });
  }, [editMode, items, copyList, shareList]);

  // ── Check-off ───────────────────────────────────────────────────────────────
  const toggleCheck = async (item: ConsolidatedItem) => {
    const nowChecked = !item.checked;
    setItems((prev) =>
      prev.map((i) => i.normalizedName === item.normalizedName ? { ...i, checked: nowChecked } : i)
    );
    const { error } = nowChecked
      ? await supabase.from("shopping_list_checks").upsert({
          household_id: householdId,
          normalized_name: item.normalizedName,
        }, { onConflict: "household_id,normalized_name", ignoreDuplicates: true })
      : await supabase
          .from("shopping_list_checks")
          .delete()
          .eq("household_id", householdId)
          .eq("normalized_name", item.normalizedName);
    if (error) {
      // Revert the optimistic check.
      setItems((prev) =>
        prev.map((i) => i.normalizedName === item.normalizedName ? { ...i, checked: !nowChecked } : i)
      );
      showError("Couldn't update item", error);
    }
  };

  // ── Clear checks ────────────────────────────────────────────────────────────
  const clearChecks = async () => {
    const previous = items;
    setItems((prev) => prev.map((i) => ({ ...i, checked: false })));
    const { error } = await supabase.from("shopping_list_checks").delete().eq("household_id", householdId);
    if (error) {
      setItems(previous); // revert
      showError("Couldn't clear checks", error);
    }
  };

  /** Only invoked from the confirmation modal — never call directly from UI. */
  const clearWeekAfterConfirm = async () => {
    if (!householdId) return;
    setClearingWeek(true);
    try {
      throwOnError(await supabase.from("week_queues").delete().eq("household_id", householdId));
      throwOnError(await supabase.from("shopping_list_checks").delete().eq("household_id", householdId));
      setClearWeekModalVisible(false);
      await loadList();
    } catch (err) {
      showError("Couldn't clear the week", err);
    } finally {
      setClearingWeek(false);
    }
  };

  // ── Add manual item ─────────────────────────────────────────────────────────
  const addManualItem = async (nameOverride?: string) => {
    const rawName = (nameOverride ?? newItemText).trim();
    const key = normalizeIngredient(rawName);
    if (!key || !householdId || addingItem) return;
    if (key.endsWith(":")) return;

    // Clear immediately so select → add feels like one action, not fill-then-clear.
    setNewItemText("");
    addInputRef.current?.focus();
    setAddingItem(true);
    try {
      const catalogRow = await ensureCatalogIngredient(householdId, rawName);
      if (!catalogRow) {
        setNewItemText(rawName);
        return;
      }

      const { data: manualRow, error: manualError } = await supabase
        .from("shopping_list_manual_items")
        .upsert(
          { household_id: householdId, normalized_name: key },
          { onConflict: "household_id,normalized_name" }
        )
        .select("id, normalized_name, quantity, unit")
        .single();
      if (manualError) throw manualError;

      const existing = items.find((i) => i.normalizedName === key);
      if (existing) {
        setItems((prev) =>
          prev.map((i) =>
            i.normalizedName === key
              ? {
                  ...i,
                  isManual: true,
                  manualItemId: manualRow.id,
                  displayName: catalogRow.display_name,
                  metadataId: catalogRow.id,
                }
              : i
          )
        );
      } else {
        setItems((prev) => {
          const next = [
            ...prev,
            {
              normalizedName: key,
              displayName: catalogRow.display_name,
              metadataId: catalogRow.id,
              sortOrder: editMode
                ? (prev[prev.length - 1]?.sortOrder ?? 0) + 10
                : catalogRow.sort_order,
              occurrences: [],
              checked: false,
              isManual: true,
              manualItemId: manualRow.id,
            },
          ];
          // Preserve the user's in-progress order while editing.
          if (editMode) return next;
          return next.sort((a, b) => a.sortOrder - b.sortOrder);
        });
      }
      setCatalog((prev) => {
        if (prev.some((c) => c.id === catalogRow.id)) return prev;
        return [...prev, catalogRow].sort((a, b) =>
          a.display_name.localeCompare(b.display_name)
        );
      });
    } catch (err) {
      setNewItemText(rawName);
      showError("Couldn't add item", err);
    } finally {
      setAddingItem(false);
      // Keep typing — don't make add a focus-stealing two-step.
      requestAnimationFrame(() => addInputRef.current?.focus());
    }
  };

  // ── Remove manual item ──────────────────────────────────────────────────────
  const removeManualItem = async (item: ConsolidatedItem) => {
    if (!item.isManual || !item.manualItemId) return;
    const previous = items;
    const fromRecipe = item.occurrences.some((o) => o.recipeTitle !== "Added");
    setItems((prev) =>
      fromRecipe
        ? prev.map((i) =>
            i.normalizedName === item.normalizedName
              ? { ...i, isManual: false, manualItemId: undefined }
              : i
          )
        : prev.filter((i) => i.normalizedName !== item.normalizedName)
    );
    const { error } = await supabase
      .from("shopping_list_manual_items")
      .delete()
      .eq("id", item.manualItemId);
    if (error) {
      setItems(previous);
      showError("Couldn't remove item", error);
    }
  };

  // ── Reorder / save order ─────────────────────────────────────────────────────
  const saveOrder = async () => {
    const updates = items.map((item, i) => ({
      id: item.metadataId,
      household_id: householdId,
      normalized_name: item.normalizedName,
      display_name: item.displayName,
      sort_order: (i + 1) * 10,
    }));
    const { error } = await supabase.from("ingredient_metadata").upsert(updates, { onConflict: "id" });
    if (error) {
      showError("Couldn't save the order", error);
      return;
    }
    setItems((prev) => prev.map((item, i) => ({ ...item, sortOrder: (i + 1) * 10 })));
  };

  // ── Render helpers ──────────────────────────────────────────────────────────
  const renderAddRow = () => (
    <View style={[styles.addRow, { zIndex: 10 }]}>
      <IngredientAutocomplete
        containerStyle={{ flex: 1 }}
        style={styles.addInput}
        placeholder="Add item…"
        value={newItemText}
        onChangeText={setNewItemText}
        catalog={catalog}
        inputRef={addInputRef}
        fillOnSelect={false}
        onSelect={(item) => {
          void addManualItem(item.display_name);
        }}
        onSubmitEditing={() => {
          void addManualItem();
        }}
        returnKeyType="done"
      />
      <Pressable
        style={[styles.addButton, (!newItemText.trim() || addingItem) && styles.buttonDisabled]}
        onPress={() => {
          void addManualItem();
        }}
        disabled={!newItemText.trim() || addingItem}
      >
        {addingItem ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.addButtonText}>Add</Text>
        )}
      </Pressable>
    </View>
  );

  const renderItemRow = (
    item: ConsolidatedItem,
    drag?: () => void,
    isActive?: boolean
  ) => {
    const fromRecipe = item.occurrences.some((o) => o.recipeTitle !== "Added");
    const canRemove = editMode && item.isManual && !fromRecipe;

    return (
      <Pressable
        onPressIn={drag}
        style={[styles.itemRow, item.checked && styles.itemRowChecked, isActive && styles.itemRowActive]}
      >
        <Pressable style={styles.checkbox} onPress={() => !editMode && toggleCheck(item)}>
          <Text style={[styles.checkboxIcon, item.checked && styles.checkboxIconChecked]}>
            {item.checked ? "●" : "○"}
          </Text>
        </Pressable>
        <View style={styles.itemContent}>
          <Text style={[styles.itemName, item.checked && styles.itemNameChecked]}>
            {item.displayName}
          </Text>
          {item.occurrences.map((occ, i) => {
            const qty = formatQty(occ.quantity, occ.unit);
            const line = [qty, occ.recipeTitle].filter(Boolean).join(" · ");
            if (!line) return null;
            return (
              <Text key={i} style={[styles.occurrence, item.checked && styles.occurrenceChecked]}>
                {line}
              </Text>
            );
          })}
        </View>
        {canRemove && (
          <Pressable style={styles.removeButton} onPress={() => removeManualItem(item)}>
            <Text style={styles.removeButtonText}>✕</Text>
          </Pressable>
        )}
      </Pressable>
    );
  };

  // ── Build list ──────────────────────────────────────────────────────────────
  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

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
          <Text style={styles.editBannerText}>
            Drag to reorder. Add items below. Tap ✕ to remove added items. Tap Done to save.
          </Text>
        </View>
        {renderAddRow()}
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
      <Text style={styles.emptyText}>
        No items yet. Add something below, or queue recipes from the week queue.
      </Text>
    ) : (
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
    );

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {renderAddRow()}
        {items.length > 0 && (
          <View style={styles.clearActionsRow}>
            <Pressable
              onPress={() => setClearWeekModalVisible(true)}
              disabled={clearingWeek}
              style={clearingWeek && styles.clearActionDisabled}
            >
              {clearingWeek ? (
                <ActivityIndicator size="small" color="#ff3b30" />
              ) : (
                <Text style={styles.clearActionText}>Clear week</Text>
              )}
            </Pressable>
            {checked.length > 0 && (
              <Pressable onPress={clearChecks}>
                <Text style={styles.clearActionText}>Clear checks</Text>
              </Pressable>
            )}
          </View>
        )}
        {body}
      </ScrollView>

      <Modal
        visible={clearWeekModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !clearingWeek && setClearWeekModalVisible(false)}
      >
        <Pressable
          style={styles.confirmModalOverlay}
          onPress={() => !clearingWeek && setClearWeekModalVisible(false)}
        >
          <Pressable style={styles.confirmModalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.confirmModalTitle}>Clear week?</Text>
            <Text style={styles.confirmModalBody}>
              This removes every recipe from your queue and clears all shopping list checkmarks.
              This cannot be undone.
            </Text>
            <View style={styles.confirmModalActions}>
              <Pressable
                style={[styles.confirmModalButton, styles.confirmModalCancelBtn]}
                onPress={() => !clearingWeek && setClearWeekModalVisible(false)}
                disabled={clearingWeek}
              >
                <Text style={styles.confirmModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmModalButton, styles.confirmModalDangerBtn]}
                onPress={() => void clearWeekAfterConfirm()}
                disabled={clearingWeek}
              >
                {clearingWeek ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmModalDangerText}>Clear all</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { paddingBottom: 48 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  addInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  addButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 64,
    alignItems: "center",
  },
  addButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  clearActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
    minHeight: 28,
  },
  clearActionText: { fontSize: 13, color: "#ff3b30", fontWeight: "600" },
  clearActionDisabled: { opacity: 0.6 },
  emptyText: { color: "#999", textAlign: "center", marginTop: 32, paddingHorizontal: 24 },

  confirmModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  confirmModalSheet: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 22,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
    color: "#111",
  },
  confirmModalBody: {
    fontSize: 15,
    color: "#555",
    lineHeight: 22,
    marginBottom: 22,
  },
  confirmModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  confirmModalButton: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
    minWidth: 100,
    alignItems: "center",
  },
  confirmModalCancelBtn: {
    backgroundColor: "#f2f2f2",
  },
  confirmModalCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  confirmModalDangerBtn: {
    backgroundColor: "#ff3b30",
    minHeight: 44,
    justifyContent: "center",
  },
  confirmModalDangerText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },


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

  checkbox: { paddingRight: 10, paddingTop: 2 },
  checkboxIcon: { fontSize: 18, color: "#ccc" },
  checkboxIconChecked: { color: "#34c759" },

  itemContent: { flex: 1 },
  itemName: { fontSize: 16, fontWeight: "600", color: "#222", marginBottom: 2 },
  itemNameChecked: { textDecorationLine: "line-through", color: "#999" },
  occurrence: { fontSize: 13, color: "#888", lineHeight: 18 },
  occurrenceChecked: { textDecorationLine: "line-through" },

  removeButton: {
    marginLeft: 8,
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeButtonText: {
    fontSize: 16,
    color: "#ff3b30",
    fontWeight: "600",
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

  buttonDisabled: { opacity: 0.6 },
});

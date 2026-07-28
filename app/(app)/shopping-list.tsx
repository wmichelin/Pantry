import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Modal,
  Share,
  Alert,
  Platform,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useNavigation, useFocusEffect, useRouter } from "expo-router";
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
  type IngredientCategory,
  type IngredientCategoryId,
} from "../../lib/ingredient-categories";
import { listHouseholdAisles } from "../../lib/household-aisles";
import {
  normalizeIngredient,
  titleCaseIngredient,
} from "../../lib/normalize-ingredient";
import {
  coerceIngredientCategory,
  sortShoppingListByAisle,
} from "../../lib/sort-shopping-list-by-aisle";
import {
  aisleSectionRowKey,
  buildAisleSectionRows,
  normalizeAisleRows,
  type AisleSectionRow,
} from "../../lib/aisle-section-list";
import { useMobileDragUi } from "../../lib/use-mobile-drag-ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsolidatedItem = {
  /** Stable row id: `recipe:name` or `manual:<uuid>`. */
  listKey: string;
  normalizedName: string;
  displayName: string;
  metadataId: string;
  sortOrder: number;
  category: IngredientCategoryId;
  occurrences: { recipeTitle: string; quantity: number | null; unit: string | null }[];
  checked: boolean;
  isManual: boolean;
  manualItemId?: string;
};

type ShoppingSectionRow = AisleSectionRow<ConsolidatedItem>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const recipeListKey = (normalizedName: string) => `recipe:${normalizedName}`;
const manualListKey = (manualItemId: string) => `manual:${manualItemId}`;
const isStandaloneManual = (item: ConsolidatedItem) => item.listKey.startsWith("manual:");
/** Check-row identity: standalone manuals must not share a check with the recipe row. */
const checkKeyFor = (item: ConsolidatedItem) =>
  isStandaloneManual(item) ? `${item.normalizedName}::manual` : item.normalizedName;
const hasManualUnit = (unit: string | null | undefined) => !!unit?.trim();

const formatQty = (quantity: number | null, unit: string | null): string => {
  const parts: string[] = [];
  if (quantity) parts.push(formatQuantity(quantity));
  if (unit) parts.push(unit);
  if (parts.length === 0) return "";
  return `(${parts.join(" ")})`;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ShoppingListScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const navigation = useNavigation();
  const router = useRouter();

  const [items, setItems] = useState<ConsolidatedItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogIngredient[]>([]);
  const [aisleOrder, setAisleOrder] = useState<IngredientCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemText, setNewItemText] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const addInputRef = useRef<TextInput>(null);
  const [clearingWeek, setClearingWeek] = useState(false);
  const [clearWeekModalVisible, setClearWeekModalVisible] = useState(false);
  /** Session-only: flat until Sort by aisle, then section headers. */
  const [aisleGrouped, setAisleGrouped] = useState(false);
  const [sectionRows, setSectionRows] = useState<ShoppingSectionRow[]>([]);
  /** Mobile / coarse: whole-row check + ≡ handle. Desktop web: checkbox check, text drags. */
  const mobileDragUi = useMobileDragUi();

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    if (!householdId) return;

    try {
      const [queueRes, checksRes, manualRes, catalogList, aisles] =
        await Promise.all([
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
            .select("id, normalized_name, quantity, unit, sort_order")
            .eq("household_id", householdId),
          listCatalogIngredients(householdId),
          listHouseholdAisles(householdId),
        ]);

      if (queueRes.error) throw queueRes.error;
      if (checksRes.error) throw checksRes.error;
      if (manualRes.error) throw manualRes.error;

      setCatalog(catalogList);
      setAisleOrder(aisles);
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
          .select("id, normalized_name, display_name, sort_order, category")
          .eq("household_id", householdId),
      ]);

      if (ingredientsRes.error) throw ingredientsRes.error;
      if (metaRes.error) throw metaRes.error;

      const metaByName = new Map(
        (metaRes.data ?? []).map((m) => [m.normalized_name, m])
      );

      // Keyed by listKey (recipe:name or manual:uuid).
      const grouped = new Map<string, ConsolidatedItem>();

      for (const ing of ingredientsRes.data ?? []) {
        const key = normalizeIngredient(ing.name);
        // Skip section headers that slipped through import (e.g. "for the salad:")
        if (key.endsWith(":")) continue;
        const meta = metaByName.get(key);
        const listKey = recipeListKey(key);
        const existing = grouped.get(listKey);
        if (existing) {
          existing.occurrences.push({
            recipeTitle: recipeTitle.get(ing.recipe_id) ?? "Unknown",
            quantity: ing.quantity,
            unit: ing.unit,
          });
        } else {
          grouped.set(listKey, {
            listKey,
            normalizedName: key,
            displayName: meta?.display_name ?? titleCaseIngredient(key),
            metadataId: meta?.id ?? "",
            sortOrder: meta?.sort_order ?? Infinity,
            category: coerceIngredientCategory(meta?.category),
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
        const recipeKey = recipeListKey(key);
        const recipeRow = grouped.get(recipeKey);
        const meta = metaByName.get(key);

        // Collapse into the recipe row only when the ad-hoc item has a unit.
        if (recipeRow && hasManualUnit(manual.unit)) {
          recipeRow.occurrences.push({
            recipeTitle: "Added",
            quantity: manual.quantity,
            unit: manual.unit,
          });
          recipeRow.isManual = true;
          recipeRow.manualItemId = manual.id;
          continue;
        }

        // Bare ad-hoc (no unit), or no recipe match → own line item.
        const listKey = manualListKey(manual.id);
        const hasQty = manual.quantity != null || !!manual.unit;
        // Prefer ::manual check key; fall back to legacy bare-name checks when no recipe row.
        const checked =
          checkedNames.has(`${key}::manual`) ||
          (!recipeRow && checkedNames.has(key));
        grouped.set(listKey, {
          listKey,
          normalizedName: key,
          displayName: meta?.display_name ?? titleCaseIngredient(key),
          metadataId: meta?.id ?? "",
          sortOrder: manual.sort_order ?? meta?.sort_order ?? Infinity,
          category: coerceIngredientCategory(meta?.category),
          occurrences: hasQty
            ? [{
                recipeTitle: "Added",
                quantity: manual.quantity,
                unit: manual.unit,
              }]
            : [],
          checked,
          isManual: true,
          manualItemId: manual.id,
        });
      }

      // Auto-create ingredient_metadata for new normalized names
      const newNames = [
        ...new Set(
          [...grouped.values()]
            .map((i) => i.normalizedName)
            .filter((k) => !metaByName.has(k))
        ),
      ];
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
          .select("id, normalized_name, display_name, sort_order, category");
        if (upsertError) throw upsertError;
        for (const m of newMeta ?? []) {
          for (const item of grouped.values()) {
            if (item.normalizedName !== m.normalized_name) continue;
            item.metadataId = m.id;
            item.displayName = m.display_name;
            item.category = coerceIngredientCategory(m.category);
            if (!isStandaloneManual(item)) {
              item.sortOrder = m.sort_order;
            }
          }
        }
        setCatalog(await listCatalogIngredients(householdId));
      }

      const sorted = [...grouped.values()].sort((a, b) => a.sortOrder - b.sortOrder);
      setItems(sorted);
      setAisleGrouped(false);
      setSectionRows([]);
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
          category: i.category,
          occurrences: i.occurrences,
        })),
        aisleOrder
      ),
    [items, aisleOrder]
  );

  const shareList = useCallback(async () => {
    const message = exportText();
    if (!message) return;
    try {
      // Plain text via the system share sheet (includes Copy on iOS/Android).
      // Web without Web Share API: fall back to clipboard.
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        typeof navigator.share !== "function"
      ) {
        await navigator.clipboard.writeText(message);
        Alert.alert("Copied", "Shopping list copied to clipboard.");
        return;
      }
      await Share.share({ message, title: "Shopping List" });
    } catch (err) {
      // User dismissing the sheet is not an error on some platforms.
      const messageText = err instanceof Error ? err.message : String(err);
      if (/cancel|dismiss/i.test(messageText)) return;
      showError("Couldn't share the list", err);
    }
  }, [exportText]);

  // Header set after sortByAisle / saveOrder are defined (below).

  // ── Check-off ───────────────────────────────────────────────────────────────
  const toggleCheck = async (item: ConsolidatedItem) => {
    const nowChecked = !item.checked;
    const checkKey = checkKeyFor(item);
    setItems((prev) =>
      prev.map((i) => (i.listKey === item.listKey ? { ...i, checked: nowChecked } : i))
    );
    const { error } = nowChecked
      ? await supabase.from("shopping_list_checks").upsert({
          household_id: householdId,
          normalized_name: checkKey,
        }, { onConflict: "household_id,normalized_name", ignoreDuplicates: true })
      : await supabase
          .from("shopping_list_checks")
          .delete()
          .eq("household_id", householdId)
          .eq("normalized_name", checkKey);
    if (error) {
      // Revert the optimistic check.
      setItems((prev) =>
        prev.map((i) => (i.listKey === item.listKey ? { ...i, checked: !nowChecked } : i))
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
      throwOnError(
        await supabase.from("shopping_list_manual_items").delete().eq("household_id", householdId)
      );
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

      const finiteOrders = items
        .map((i) => i.sortOrder)
        .filter((n): n is number => Number.isFinite(n));
      // New one-offs go to the top so the user sees them; Sort by aisle re-places them.
      const nextSort =
        finiteOrders.length === 0 ? 10 : Math.min(...finiteOrders) - 10;

      const { data: manualRow, error: manualError } = await supabase
        .from("shopping_list_manual_items")
        .upsert(
          { household_id: householdId, normalized_name: key, sort_order: nextSort },
          { onConflict: "household_id,normalized_name" }
        )
        .select("id, normalized_name, quantity, unit, sort_order")
        .single();
      if (manualError) throw manualError;

      const recipeRow = items.find((i) => i.listKey === recipeListKey(key));
      const collapse = !!recipeRow && hasManualUnit(manualRow.unit);

      if (collapse && recipeRow) {
        setItems((prev) =>
          prev.map((i) =>
            i.listKey === recipeRow.listKey
              ? {
                  ...i,
                  isManual: true,
                  manualItemId: manualRow.id,
                  displayName: catalogRow.display_name,
                  metadataId: catalogRow.id,
                  category: catalogRow.category,
                  occurrences: [
                    ...i.occurrences.filter((o) => o.recipeTitle !== "Added"),
                    {
                      recipeTitle: "Added",
                      quantity: manualRow.quantity,
                      unit: manualRow.unit,
                    },
                  ],
                }
              : i
          )
        );
      } else {
        // Bare ad-hoc beside a recipe row, or no recipe match — own line at top.
        const listKey = manualListKey(manualRow.id);
        const sortOrder = manualRow.sort_order ?? nextSort;
        setAisleGrouped(false);
        setSectionRows([]);
        setItems((prev) => {
          const without = prev.filter((i) => i.listKey !== listKey);
          return [
            {
              listKey,
              normalizedName: key,
              displayName: catalogRow.display_name,
              metadataId: catalogRow.id,
              sortOrder,
              category: catalogRow.category,
              occurrences:
                manualRow.quantity != null || !!manualRow.unit
                  ? [{
                      recipeTitle: "Added",
                      quantity: manualRow.quantity,
                      unit: manualRow.unit,
                    }]
                  : [],
              checked: false,
              isManual: true,
              manualItemId: manualRow.id,
            },
            ...without,
          ];
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
    if (isStandaloneManual(item)) {
      setItems((prev) => prev.filter((i) => i.listKey !== item.listKey));
    } else {
      // Collapsed into a recipe row — drop the "Added" occurrence only.
      setItems((prev) =>
        prev.map((i) =>
          i.listKey === item.listKey
            ? {
                ...i,
                isManual: false,
                manualItemId: undefined,
                occurrences: i.occurrences.filter((o) => o.recipeTitle !== "Added"),
              }
            : i
        )
      );
    }
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
  const saveOrder = useCallback(async (ordered: ConsolidatedItem[]) => {
    if (!householdId) return;

    const withOrder = ordered.map((item, i) => ({
      ...item,
      sortOrder: (i + 1) * 10,
    }));

    const metaUpdates = withOrder
      .filter((item) => !!item.metadataId)
      .map((item) => ({
        id: item.metadataId,
        household_id: householdId,
        normalized_name: item.normalizedName,
        display_name: item.displayName,
        sort_order: item.sortOrder,
        category: item.category,
      }));

    const manualUpdates = withOrder.filter(
      (item) => isStandaloneManual(item) && !!item.manualItemId
    );

    if (metaUpdates.length > 0) {
      const { error } = await supabase
        .from("ingredient_metadata")
        .upsert(metaUpdates, { onConflict: "id" });
      if (error) {
        showError("Couldn't save the order", error);
        return;
      }
    }

    for (const item of manualUpdates) {
      const { error } = await supabase
        .from("shopping_list_manual_items")
        .update({ sort_order: item.sortOrder })
        .eq("id", item.manualItemId!);
      if (error) {
        showError("Couldn't save the order", error);
        return;
      }
    }

    setItems(withOrder);
    setCatalog((prev) => {
      const byId = new Map(withOrder.map((i) => [i.metadataId, i.category]));
      return prev.map((c) => {
        const next = byId.get(c.id);
        return next && next !== c.category ? { ...c, category: next } : c;
      });
    });
  }, [householdId]);

  const sortByAisle = useCallback(() => {
    if (items.length === 0) return;
    const ordered = sortShoppingListByAisle(items, aisleOrder);
    const rows = buildAisleSectionRows(ordered, aisleOrder);
    setItems(ordered);
    setSectionRows(rows);
    setAisleGrouped(true);
    void saveOrder(ordered);
  }, [items, aisleOrder, saveOrder]);

  // ── Header buttons ──────────────────────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          onPress={() => {
            if (householdId) {
              router.replace({ pathname: "/(app)/household", params: { id: householdId } });
              return;
            }
            if (router.canGoBack()) router.back();
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Back to household"
        >
          <Text style={{ color: "#2f95dc", fontSize: 16, fontWeight: "600" }}>‹ Back</Text>
        </Pressable>
      ),
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {items.length > 0 && (
            <Pressable onPress={sortByAisle} style={{ paddingHorizontal: 10 }}>
              <Text style={{ color: "#2f95dc", fontSize: 15, fontWeight: "600" }}>
                Sort by aisle
              </Text>
            </Pressable>
          )}
          {items.length > 0 && (
            <Pressable onPress={shareList} style={{ paddingHorizontal: 12 }}>
              <Text style={{ color: "#2f95dc", fontSize: 16, fontWeight: "600" }}>
                Share
              </Text>
            </Pressable>
          )}
        </View>
      ),
    });
  }, [items, shareList, sortByAisle, householdId, navigation, router]);

  const handleReorder = (data: ConsolidatedItem[]) => {
    setItems(data);
    void saveOrder(data);
  };

  const handleSectionReorder = (rows: ShoppingSectionRow[]) => {
    const { items: nextItems, rows: nextRows } = normalizeAisleRows(
      rows,
      aisleOrder
    );
    setSectionRows(nextRows);
    setItems(nextItems);
    void saveOrder(nextItems);
  };

  // Keep section headers in sync when items change while grouped (check/add/remove).
  useEffect(() => {
    if (!aisleGrouped) return;
    setSectionRows(buildAisleSectionRows(items, aisleOrder));
  }, [items, aisleGrouped, aisleOrder]);

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

  const renderAisleHeader = (label: string) => (
    <View style={styles.aisleHeaderRow}>
      <Text style={styles.aisleHeaderText}>{label}</Text>
    </View>
  );

  const renderItemRow = (
    item: ConsolidatedItem,
    drag?: () => void,
    isActive?: boolean
  ) => {
    // ✕ on standalone manuals and collapsed recipe+ad-hoc rows.
    const canRemove = item.isManual;
    const webNoDrag =
      Platform.OS === "web" ? ({ dataSet: { noDrag: "true" } } as const) : {};

    const checkbox = (
      <View style={styles.checkbox}>
        <Text style={[styles.checkboxIcon, item.checked && styles.checkboxIconChecked]}>
          {item.checked ? "●" : "○"}
        </Text>
      </View>
    );

    const body = (
      <>
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
      </>
    );

    return (
      <View
        style={[styles.itemRow, item.checked && styles.itemRowChecked, isActive && styles.itemRowActive]}
      >
        {mobileDragUi ? (
          <Pressable
            style={styles.itemMain}
            onPress={() => toggleCheck(item)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.checked }}
            accessibilityLabel={item.displayName}
            {...webNoDrag}
          >
            {checkbox}
            <View style={styles.itemContent}>{body}</View>
          </Pressable>
        ) : (
          <>
            <Pressable
              style={styles.checkboxHit}
              onPress={() => toggleCheck(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.checked }}
              accessibilityLabel={item.displayName}
              {...webNoDrag}
            >
              {checkbox}
            </Pressable>
            <View style={styles.itemContent}>{body}</View>
          </>
        )}
        {canRemove && (
          <Pressable
            style={styles.removeButton}
            onPress={() => removeManualItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.displayName}`}
            {...webNoDrag}
          >
            <Text style={styles.removeButtonText}>✕</Text>
          </Pressable>
        )}
        {/* Native: dedicated handle. Web mobile: SortableList renders ≡ outside the row. */}
        {Platform.OS !== "web" && drag ? (
          <Pressable
            style={styles.dragHandle}
            onPressIn={drag}
            accessibilityRole="button"
            accessibilityLabel="Drag to reorder"
          >
            <Text style={styles.dragHandleIcon}>≡</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const renderEditAislesLink = () => (
    <Pressable
      style={styles.editAislesLink}
      onPress={() => {
        if (!householdId) return;
        router.push({
          pathname: "/(app)/edit-aisles",
          params: { householdId },
        });
      }}
    >
      <Text style={styles.editAislesLinkText}>Edit aisles</Text>
    </Pressable>
  );

  const hasChecked = items.some((i) => i.checked);

  // ── Loading / empty ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <>
      <View style={styles.container}>
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
            {hasChecked && (
              <Pressable onPress={clearChecks}>
                <Text style={styles.clearActionText}>Clear checks</Text>
              </Pressable>
            )}
          </View>
        )}
        {items.length === 0 ? (
          <>
            <Text style={styles.emptyText}>
              No items yet. Add something below, or queue recipes from the week queue.
            </Text>
            {renderEditAislesLink()}
          </>
        ) : aisleGrouped ? (
          <SortableList
            items={sectionRows}
            keyExtractor={aisleSectionRowKey}
            isDraggable={(row) => row.kind === "item"}
            renderItem={(row, drag, isActive) =>
              row.kind === "header"
                ? renderAisleHeader(row.label)
                : renderItemRow(row.item, drag, isActive)
            }
            onReorder={handleSectionReorder}
            ListFooterComponent={renderEditAislesLink()}
          />
        ) : (
          <SortableList
            items={items}
            keyExtractor={(item) => item.listKey}
            renderItem={(item, drag, isActive) => renderItemRow(item, drag, isActive)}
            onReorder={handleReorder}
            ListFooterComponent={renderEditAislesLink()}
          />
        )}
      </View>

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
              This removes every recipe from your queue, clears checkmarks, and deletes
              one-off items you added. This cannot be undone.
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


  itemRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f2f2",
    backgroundColor: "#fff",
  },
  itemRowChecked: { opacity: 0.45 },
  itemRowActive: { backgroundColor: "#f0f7ff", elevation: 4 },

  itemMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    minWidth: 0,
  },
  checkboxHit: {
    justifyContent: "flex-start",
    paddingRight: 4,
    paddingTop: 2,
  },
  checkbox: { paddingRight: 10, paddingTop: 0 },
  checkboxIcon: { fontSize: 18, color: "#ccc" },
  checkboxIconChecked: { color: "#34c759" },

  itemContent: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 16, fontWeight: "600", color: "#222", marginBottom: 2 },
  itemNameChecked: { textDecorationLine: "line-through", color: "#999" },
  occurrence: { fontSize: 13, color: "#888", lineHeight: 18 },
  occurrenceChecked: { textDecorationLine: "line-through" },

  removeButton: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingTop: 2,
    justifyContent: "flex-start",
  },
  removeButtonText: {
    fontSize: 16,
    color: "#ff3b30",
    fontWeight: "600",
  },
  dragHandle: {
    marginLeft: 4,
    width: 72,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  dragHandleIcon: { fontSize: 20, color: "#bbb", lineHeight: 22 },

  aisleHeaderRow: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e8e8e8",
  },
  aisleHeaderText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  editAislesLink: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  editAislesLinkText: {
    color: "#2f95dc",
    fontSize: 15,
    fontWeight: "600",
  },

  buttonDisabled: { opacity: 0.6 },
});

import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { showError, throwOnError } from "../../lib/db";
import { useTheme } from "../../lib/theme-context";
import type { ThemeColors } from "../../lib/theme";

type WeekQueueEntry = {
  id: string;
  recipe_id: string;
  recipes: { id: string; title: string };
};

export default function WeekQueueScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entries, setEntries] = useState<WeekQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [clearingWeek, setClearingWeek] = useState(false);
  const [clearWeekModalVisible, setClearWeekModalVisible] = useState(false);

  const loadQueue = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("week_queues")
        .select("id, recipe_id, recipes(id, title)")
        .eq("household_id", householdId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      // recipe_id -> recipes is to-one, so each row's `recipes` is a single object
      // at runtime even though the query builder infers an array.
      setEntries((data as unknown as WeekQueueEntry[]) ?? []);
    } catch (err) {
      showError("Couldn't load the queue", err);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useFocusEffect(useCallback(() => { loadQueue(); }, [loadQueue]));

  const handleRemove = async (entryId: string) => {
    const { error } = await supabase.from("week_queues").delete().eq("id", entryId);
    setConfirmRemoveId(null);
    if (error) {
      showError("Couldn't remove from queue", error);
      return;
    }
    loadQueue();
  };

  /** Only invoked from the confirmation modal — never call directly from UI. */
  const clearWeekAfterConfirm = async () => {
    if (!householdId) return;
    setClearingWeek(true);
    try {
      throwOnError(await supabase.from("week_queues").delete().eq("household_id", householdId));
      throwOnError(await supabase.from("shopping_list_checks").delete().eq("household_id", householdId));
      setClearWeekModalVisible(false);
      loadQueue();
    } catch (err) {
      showError("Couldn't clear the queue", err);
    } finally {
      setClearingWeek(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.weekLabel}>Queue</Text>
        <Pressable
          style={styles.shoppingButton}
          onPress={() =>
            router.push({ pathname: "/(app)/shopping-list", params: { householdId } })
          }
        >
          <Text style={styles.shoppingButtonText}>Shopping List</Text>
        </Pressable>
      </View>
      <View style={styles.clearWeekRow}>
        <Pressable
          onPress={() => setClearWeekModalVisible(true)}
          disabled={clearingWeek}
          style={clearingWeek && styles.clearWeekDisabled}
        >
          {clearingWeek ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Text style={styles.clearWeekText}>Clear week</Text>
          )}
        </Pressable>
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
                  <ActivityIndicator color={colors.primaryText} />
                ) : (
                  <Text style={styles.confirmModalDangerText}>Clear all</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ScrollView contentContainerStyle={styles.list}>
        {entries.length === 0 ? (
          <Text style={styles.emptyText}>
            No recipes queued yet.{"\n"}Open a recipe and tap "+ Add to queue".
          </Text>
        ) : (
          entries.map((entry) => (
            <View key={entry.id} style={styles.row}>
              <Pressable
                style={styles.recipeInfo}
                onPress={() =>
                  router.push({
                    pathname: "/(app)/recipe/[id]",
                    params: { id: entry.recipe_id },
                  })
                }
              >
                <Text style={styles.recipeTitle}>{entry.recipes.title}</Text>
              </Pressable>

              {confirmRemoveId === entry.id ? (
                <View style={styles.confirmInline}>
                  <Text style={styles.confirmText}>Remove?</Text>
                  <Pressable onPress={() => handleRemove(entry.id)}>
                    <Text style={styles.confirmYes}>Yes</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmRemoveId(null)}>
                    <Text style={styles.confirmCancel}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setConfirmRemoveId(entry.id)}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  weekLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  shoppingButton: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  shoppingButtonText: { color: colors.primaryText, fontSize: 14, fontWeight: "600" },
  clearWeekRow: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: "flex-start",
  },
  clearWeekText: { fontSize: 14, fontWeight: "600", color: colors.danger },
  clearWeekDisabled: { opacity: 0.6 },
  list: { padding: 16, gap: 4 },
  emptyText: {
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 32,
    lineHeight: 22,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  recipeInfo: { flex: 1 },
  recipeTitle: { fontSize: 16, color: colors.text },
  removeText: { fontSize: 14, color: colors.danger, paddingLeft: 12 },
  confirmInline: { flexDirection: "row", alignItems: "center", gap: 10 },
  confirmText: { fontSize: 13, color: colors.text },
  confirmYes: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  confirmCancel: { fontSize: 13, color: colors.textMuted },

  confirmModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  confirmModalSheet: {
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 22,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
    color: colors.text,
  },
  confirmModalBody: {
    fontSize: 15,
    color: colors.textSecondary,
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
    backgroundColor: colors.surfaceMuted,
  },
  confirmModalCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  confirmModalDangerBtn: {
    backgroundColor: colors.danger,
    minHeight: 44,
    justifyContent: "center",
  },
  confirmModalDangerText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primaryText,
  },
  });
}

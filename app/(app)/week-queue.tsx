import { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { getWeekStart } from "../../lib/week";

type WeekQueueEntry = {
  id: string;
  recipe_id: string;
  recipes: { id: string; title: string };
};

export default function WeekQueueScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const router = useRouter();
  const [entries, setEntries] = useState<WeekQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const { data } = await supabase
      .from("week_queues")
      .select("id, recipe_id, recipes(id, title)")
      .eq("household_id", householdId)
      .eq("week_start", getWeekStart())
      .order("created_at", { ascending: true });

    setEntries((data as WeekQueueEntry[]) ?? []);
    setLoading(false);
  }, [householdId]);

  useFocusEffect(useCallback(() => { loadQueue(); }, [loadQueue]));

  const handleRemove = async (entryId: string) => {
    await supabase.from("week_queues").delete().eq("id", entryId);
    setConfirmRemoveId(null);
    loadQueue();
  };

  const weekStart = getWeekStart();
  const weekLabel = new Date(weekStart + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

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
        <Text style={styles.weekLabel}>Week of {weekLabel}</Text>
        <Pressable
          style={styles.shoppingButton}
          onPress={() =>
            router.push({ pathname: "/(app)/shopping-list", params: { householdId } })
          }
        >
          <Text style={styles.shoppingButtonText}>Shopping List</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {entries.length === 0 ? (
          <Text style={styles.emptyText}>
            No recipes queued for this week yet.{"\n"}Open a recipe and tap "+ Add to this week".
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

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  weekLabel: { fontSize: 15, fontWeight: "600", color: "#333" },
  shoppingButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  shoppingButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  list: { padding: 16, gap: 4 },
  emptyText: {
    color: "#999",
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
    borderBottomColor: "#eee",
  },
  recipeInfo: { flex: 1 },
  recipeTitle: { fontSize: 16, color: "#222" },
  removeText: { fontSize: 14, color: "#ff3b30", paddingLeft: 12 },
  confirmInline: { flexDirection: "row", alignItems: "center", gap: 10 },
  confirmText: { fontSize: 13, color: "#333" },
  confirmYes: { fontSize: 13, color: "#ff3b30", fontWeight: "600" },
  confirmCancel: { fontSize: 13, color: "#999" },
});

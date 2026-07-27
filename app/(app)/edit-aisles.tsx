import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import {
  useLocalSearchParams,
  useFocusEffect,
  useNavigation,
  useRouter,
} from "expo-router";
import { supabase } from "../../lib/supabase";
import { showError } from "../../lib/db";
import { SortableList } from "../../components/SortableList";
import {
  resolveAisleCategoryOrder,
  type IngredientCategory,
} from "../../lib/ingredient-categories";

export default function EditAislesScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const navigation = useNavigation();
  const router = useRouter();

  const [aisleCategories, setAisleCategories] = useState<IngredientCategory[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      const { data, error } = await supabase
        .from("households")
        .select("aisle_category_order")
        .eq("id", householdId)
        .single();
      if (error) throw error;
      setAisleCategories(resolveAisleCategoryOrder(data.aisle_category_order));
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
    const { error } = await supabase
      .from("households")
      .update({ aisle_category_order: ordered.map((c) => c.id) })
      .eq("id", householdId);
    setSaving(false);
    if (error) {
      setAisleCategories(previous);
      showError("Couldn't save aisle order", error);
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
      <Text style={styles.hint}>Drag to match your store walk path</Text>

      <SortableList
        items={aisleCategories}
        keyExtractor={(item) => item.id}
        onReorder={(next) => {
          void saveAisleOrder(next);
        }}
        renderItem={(item, drag, isActive) => (
          <View style={[styles.row, isActive && styles.rowActive]}>
            {drag ? (
              <Pressable style={styles.dragHit} onPressIn={drag}>
                <Text style={styles.label}>{item.label}</Text>
              </Pressable>
            ) : (
              <Text style={styles.label}>{item.label}</Text>
            )}
          </View>
        )}
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
});

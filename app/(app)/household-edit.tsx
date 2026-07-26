import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Platform,
} from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { showError } from "../../lib/db";
import { SortableList } from "../../components/SortableList";
import {
  resolveAisleCategoryOrder,
  type IngredientCategory,
} from "../../lib/ingredient-categories";
import { useTheme } from "../../lib/theme-context";
import type { ThemeColors } from "../../lib/theme";
import ThemePreferencePicker from "../../components/ThemePreferencePicker";

type Member = { id: string; display_name: string; role: string };
type Household = {
  id: string;
  name: string;
  invite_code: string;
  aisle_category_order: string[] | null;
};
type Store = { id: string; name: string; sort_order: number };

export default function HouseholdEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signOut } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [aisleCategories, setAisleCategories] = useState<IngredientCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeInput, setStoreInput] = useState("");
  const [savingAisles, setSavingAisles] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [hRes, mRes, sRes] = await Promise.all([
        supabase
          .from("households")
          .select("id, name, invite_code, aisle_category_order")
          .eq("id", id)
          .single(),
        supabase.from("household_members").select("id, display_name, role").eq("household_id", id),
        supabase.from("stores").select("id, name, sort_order").eq("household_id", id).order("sort_order"),
      ]);
      if (hRes.error) throw hRes.error;
      setHousehold(hRes.data);
      setAisleCategories(resolveAisleCategoryOrder(hRes.data.aisle_category_order));
      if (mRes.data) setMembers(mRes.data);
      if (sRes.data) setStores(sRes.data);
    } catch (err) {
      showError("Couldn't load household", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const addStore = async () => {
    const name = storeInput.trim();
    if (!name || !id) return;
    const sort_order = stores.length * 10;
    const { data, error } = await supabase
      .from("stores")
      .insert({ household_id: id, name, sort_order })
      .select("id, name, sort_order")
      .single();
    if (error) {
      showError("Couldn't add store", error);
      return;
    }
    if (data) setStores((prev) => [...prev, data]);
    setStoreInput("");
  };

  const deleteStore = async (storeId: string) => {
    const previous = stores;
    setStores((prev) => prev.filter((s) => s.id !== storeId));
    const { error } = await supabase.from("stores").delete().eq("id", storeId);
    if (error) {
      setStores(previous);
      showError("Couldn't delete store", error);
    }
  };

  const saveAisleOrder = async (ordered: IngredientCategory[]) => {
    if (!id) return;
    setSavingAisles(true);
    const previous = aisleCategories;
    setAisleCategories(ordered);
    const { error } = await supabase
      .from("households")
      .update({ aisle_category_order: ordered.map((c) => c.id) })
      .eq("id", id);
    setSavingAisles(false);
    if (error) {
      setAisleCategories(previous);
      showError("Couldn't save aisle order", error);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.inviteBox}>
        <Text style={styles.inviteLabel}>Invite Code</Text>
        <Text style={styles.inviteCode}>{household?.invite_code}</Text>
        <Text style={styles.inviteHint}>Share this code to invite members</Text>
      </View>

      <Text style={styles.sectionTitle}>Members ({members.length})</Text>
      {members.map((m) => (
        <View key={m.id} style={styles.memberRow}>
          <Text style={styles.memberName}>{m.display_name}</Text>
          <Text style={styles.memberRole}>{m.role}</Text>
        </View>
      ))}

      <Text style={[styles.sectionTitle, styles.storesSectionTitle]}>
        Stores ({stores.length})
      </Text>
      {stores.map((s) => (
        <View key={s.id} style={styles.storeRow}>
          <Text style={styles.storeName}>{s.name}</Text>
          <Pressable onPress={() => deleteStore(s.id)}>
            <Text style={styles.storeDelete}>×</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.storeInputRow}>
        <TextInput
          style={styles.storeInputField}
          placeholder="Add a store…"
          placeholderTextColor={colors.textMuted}
          value={storeInput}
          onChangeText={setStoreInput}
          returnKeyType="done"
          onSubmitEditing={addStore}
          autoCapitalize="words"
        />
        <Pressable style={styles.storeAddButton} onPress={addStore}>
          <Text style={styles.storeAddButtonText}>Add</Text>
        </Pressable>
      </View>

      <View style={styles.aisleHeader}>
        <Text style={[styles.sectionTitle, styles.aisleSectionTitle]}>
          Aisle order ({aisleCategories.length})
        </Text>
        {savingAisles ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      <Text style={styles.aisleHint}>Drag to match your store walk path</Text>
      <SortableList
        items={aisleCategories}
        keyExtractor={(item) => item.id}
        nestedInScroll
        onReorder={(next) => {
          void saveAisleOrder(next);
        }}
        renderItem={(item, drag, isActive) => (
          <View style={[styles.aisleRow, isActive && styles.aisleRowActive]}>
            {drag ? (
              <Pressable style={styles.aisleDragHit} onPressIn={drag}>
                <Text style={styles.aisleLabel}>{item.label}</Text>
              </Pressable>
            ) : (
              <Text style={styles.aisleLabel}>{item.label}</Text>
            )}
            {Platform.OS !== "web" ? (
              <Text style={styles.aisleHandle}>≡</Text>
            ) : null}
          </View>
        )}
      />

      <ThemePreferencePicker />

      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.background,
    },
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 24, paddingBottom: 48 },
    inviteBox: {
      backgroundColor: colors.primarySoft,
      borderRadius: 8,
      padding: 16,
      alignItems: "center",
      marginBottom: 24,
    },
    inviteLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    inviteCode: {
      fontSize: 28,
      fontWeight: "700",
      letterSpacing: 4,
      color: colors.primary,
      marginVertical: 4,
    },
    inviteHint: { fontSize: 12, color: colors.textMuted },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      marginBottom: 8,
      color: colors.text,
    },
    storesSectionTitle: { marginTop: 24 },
    memberRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    memberName: { fontSize: 16, color: colors.text },
    memberRole: { fontSize: 14, color: colors.textMuted },
    storeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    storeName: { fontSize: 16, color: colors.text },
    storeDelete: { fontSize: 20, color: colors.textMuted, paddingHorizontal: 4 },
    storeInputRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 8,
      marginBottom: 4,
    },
    storeInputField: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
      backgroundColor: colors.surface,
      color: colors.text,
    },
    storeAddButton: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      justifyContent: "center",
    },
    storeAddButtonText: { color: colors.primaryText, fontSize: 14, fontWeight: "600" },
    aisleHeader: {
      marginTop: 28,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    aisleSectionTitle: { marginBottom: 0, flex: 1 },
    aisleHint: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: 8 },
    aisleRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    aisleRowActive: { backgroundColor: colors.primarySoft },
    aisleDragHit: { flex: 1 },
    aisleLabel: { flex: 1, fontSize: 16, color: colors.text },
    aisleHandle: { fontSize: 20, color: colors.textMuted, paddingHorizontal: 8 },
    signOut: { marginTop: 40, alignSelf: "center" },
    signOutText: { color: colors.textMuted, fontSize: 14 },
  });
}

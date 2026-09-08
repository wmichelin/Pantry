import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { errorMessage } from "../../lib/db";
import { activeCatalogSettingsAPI } from "../../lib/active-catalog-settings";
import { useSettingsOperation } from "../../lib/use-settings-operation";

type Member = { id: string; display_name: string; role: string };
type Household = {
  id: string;
  name: string;
  invite_code: string;
};
type Store = { id: string; name: string; sort_order: number };

export default function HouseholdEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <HouseholdSettings key={id} id={id} />;
}

function HouseholdSettings({ id }: { id: string }) {
  const { signOut } = useAuth();
  const navigation = useNavigation();
  const router = useRouter();

  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeInput, setStoreInput] = useState("");
  const [notice, setNotice] = useState("");
  const operation = useSettingsOperation();
  const { pending, epoch, busy } = operation;

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          onPress={() => {
            if (id) {
              router.replace({ pathname: "/(app)/household", params: { id } });
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
    });
  }, [id, navigation, router]);

  const loadData = useCallback(async () => {
    if (!id || pending.current) return;
    const version = ++epoch.current;
    try {
      const api = await activeCatalogSettingsAPI();
      if (api) {
        const view = await api.settings(id);
        if (version !== epoch.current) return;
        setHousehold(view.household);
        setMembers(view.members);
        setStores(view.stores);
        return;
      }
      const [hRes, mRes, sRes] = await Promise.all([
        supabase
          .from("households")
          .select("id, name, invite_code")
          .eq("id", id)
          .single(),
        supabase.from("household_members").select("id, display_name, role").eq("household_id", id),
        supabase.from("stores").select("id, name, sort_order").eq("household_id", id).order("sort_order"),
      ]);
      if (hRes.error) throw hRes.error;
      if (mRes.error) throw mRes.error;
      if (sRes.error) throw sRes.error;
      if (version !== epoch.current) return;
      setHousehold(hRes.data);
      if (mRes.data) setMembers(mRes.data);
      if (sRes.data) setStores(sRes.data);
    } catch (err) {
      if (version === epoch.current) setNotice(`Couldn't load household: ${errorMessage(err)}`);
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }, [id, pending, epoch]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const addStore = async () => {
    const name = storeInput.trim();
    if (!name || !id || !operation.begin()) return;
    setNotice("");
    try {
      const api = await activeCatalogSettingsAPI();
      if (api) {
        const view = await api.addStore(id, name);
        setHousehold(view.household);
        setMembers(view.members);
        setStores(view.stores);
      } else {
    const sort_order = stores.length * 10;
    const { data, error } = await supabase
      .from("stores")
      .insert({ household_id: id, name, sort_order })
      .select("id, name, sort_order")
      .single();
    if (error) throw error;
    if (data) setStores((prev) => [...prev, data]);
      }
    setStoreInput("");
    } catch (err) {
      setNotice(`Couldn't add store: ${errorMessage(err)}`);
    } finally {
      operation.end();
    }
  };

  const deleteStore = async (storeId: string) => {
    if (!id || !operation.begin()) return;
    setNotice("");
    try {
      const api = await activeCatalogSettingsAPI();
      if (api) {
        const view = await api.removeStore(id, storeId);
        setHousehold(view.household);
        setMembers(view.members);
        setStores(view.stores);
      } else {
        const { error } = await supabase.from("stores").delete().eq("id", storeId).eq("household_id", id);
        if (error) throw error;
        setStores(prev => prev.filter(s => s.id !== storeId));
      }
    } catch (err) {
      setNotice(`Couldn't delete store: ${errorMessage(err)}`);
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {notice ? <Text accessibilityRole="alert" style={{ color: "#b42318", marginBottom: 12 }}>{notice}</Text> : null}
      <View style={styles.inviteBox}>
        <Text style={styles.inviteLabel}>Invite code</Text>
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
          <Pressable onPress={() => deleteStore(s.id)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Remove store ${s.name}`}>
            <Text style={styles.storeDelete}>×</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.storeInputRow}>
        <TextInput
          style={styles.storeInputField}
          placeholder="Add a store…"
          value={storeInput}
          onChangeText={setStoreInput}
          returnKeyType="done"
          onSubmitEditing={addStore}
          autoCapitalize="words"
          editable={!busy}
        />
        <Pressable style={[styles.storeAddButton, busy && { opacity: 0.5 }]} onPress={addStore} disabled={busy || !storeInput.trim()}>
          <Text style={styles.storeAddButtonText}>{busy ? "Saving…" : "Add"}</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.aislesLink}
        onPress={() =>
          router.push({
            pathname: "/(app)/edit-aisles",
            params: { householdId: id },
          })
        }
      >
        <Text style={styles.aislesLinkText}>Edit aisle order →</Text>
      </Pressable>

      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 24, paddingBottom: 48 },
  inviteBox: {
    backgroundColor: "#f0f7ff",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginBottom: 24,
  },
  inviteLabel: {
    fontSize: 12,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  inviteCode: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 4,
    color: "#2f95dc",
    marginVertical: 4,
  },
  inviteHint: { fontSize: 12, color: "#999" },
  sectionTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  storesSectionTitle: { marginTop: 24 },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  memberName: { fontSize: 16 },
  memberRole: { fontSize: 14, color: "#999" },
  storeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  storeName: { fontSize: 16 },
  storeDelete: { fontSize: 20, color: "#ccc", paddingHorizontal: 4 },
  storeInputRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  storeInputField: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: "#fafafa",
  },
  storeAddButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: "center",
  },
  storeAddButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  aislesLink: {
    marginTop: 28,
    paddingVertical: 12,
    alignItems: "center",
  },
  aislesLinkText: {
    color: "#2f95dc",
    fontSize: 16,
    fontWeight: "600",
  },
  signOut: { marginTop: 24, alignSelf: "center" },
  signOutText: { color: "#999", fontSize: 14 },
});

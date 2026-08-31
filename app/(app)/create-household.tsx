import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { createHousehold, stagingAPIOrigin } from "../../lib/pantry-api";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default function CreateHouseholdScreen() {
  const { user, session } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);

    const displayName =
      user?.user_metadata?.display_name ?? user?.email ?? "Owner";

    const apiURL = stagingAPIOrigin();
    if (apiURL && session?.access_token) {
      try {
        const household = await createHousehold(
          apiURL,
          session.access_token,
          name.trim(),
          displayName
        );
        setLoading(false);
        router.replace({
          pathname: "/(app)/household",
          params: { id: household.id },
        });
      } catch (error) {
        setLoading(false);
        Alert.alert("Error", error instanceof Error ? error.message : "Could not create household.");
      }
      return;
    }

    const inviteCode = generateInviteCode();

    const { data: household, error: hError } = await supabase
      .from("households")
      .insert({ name: name.trim(), invite_code: inviteCode, created_by: user!.id })
      .select()
      .single();

    if (hError) {
      setLoading(false);
      Alert.alert("Error", hError.message);
      return;
    }

    const { error: mError } = await supabase.from("household_members").insert({
      household_id: household.id,
      user_id: user!.id,
      display_name: displayName,
      role: "owner",
    });

    setLoading(false);

    if (mError) {
      Alert.alert("Error", mError.message);
      return;
    }

    router.replace({
      pathname: "/(app)/household",
      params: { id: household.id },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Household Name</Text>
      <TextInput
        style={styles.input}
        placeholder='e.g. "The Michelins"'
        value={name}
        onChangeText={setName}
        autoFocus
      />

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Creating..." : "Create Household"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#fff",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  button: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});

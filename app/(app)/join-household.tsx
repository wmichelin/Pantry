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
import { showError } from "../../lib/db";
import { joinHousehold, stagingAPIOrigin } from "../../lib/pantry-api";

export default function JoinHouseholdScreen() {
  const { user, session } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);

    const displayName =
      user?.user_metadata?.display_name ?? user?.email ?? "Member";
    const apiURL = stagingAPIOrigin();
    if (apiURL && session?.access_token) {
      try {
        const household = await joinHousehold(
          apiURL,
          session.access_token,
          trimmed,
          displayName
        );
        setLoading(false);
        if (household.already_member) {
          Alert.alert("Already a member", "You're already in this household.");
          return;
        }
        router.replace({
          pathname: "/(app)/household",
          params: { id: household.id },
        });
      } catch (error) {
        setLoading(false);
        Alert.alert("Error", error instanceof Error ? error.message : "Could not join household.");
      }
      return;
    }

    // Exact-match lookup via a SECURITY DEFINER RPC so households are not broadly
    // readable (see migration 20260613000004_secure_invite_lookup).
    const { data: rows, error: lookupError } = await supabase.rpc(
      "lookup_household_by_invite",
      { p_code: trimmed },
    );
    const household = rows?.[0];

    if (lookupError) {
      setLoading(false);
      showError("Couldn't look up invite", lookupError);
      return;
    }

    if (!household) {
      setLoading(false);
      Alert.alert("Not Found", "No household found with that invite code.");
      return;
    }

    const { error: joinError } = await supabase
      .from("household_members")
      .insert({
        household_id: household.id,
        user_id: user!.id,
        display_name: displayName,
        role: "member",
      });

    setLoading(false);

    if (joinError) {
      if (joinError.code === "23505") {
        Alert.alert("Already a member", "You're already in this household.");
      } else {
        Alert.alert("Error", joinError.message);
      }
      return;
    }

    router.replace({
      pathname: "/(app)/household",
      params: { id: household.id },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Invite Code</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter invite code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        maxLength={32}
        autoFocus
      />

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleJoin}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Joining..." : "Join Household"}
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
    fontSize: 20,
    backgroundColor: "#fafafa",
    letterSpacing: 4,
    textAlign: "center",
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

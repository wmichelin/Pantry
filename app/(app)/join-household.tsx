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

export default function JoinHouseholdScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);

    const { data: household, error: lookupError } = await supabase
      .from("households")
      .select("id, name")
      .eq("invite_code", trimmed)
      .maybeSingle();

    if (lookupError || !household) {
      setLoading(false);
      Alert.alert("Not Found", "No household found with that invite code.");
      return;
    }

    const displayName =
      user?.user_metadata?.display_name ?? user?.email ?? "Member";

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
        placeholder="Enter 6-character code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        maxLength={6}
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

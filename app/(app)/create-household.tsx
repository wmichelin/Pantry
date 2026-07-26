import { useMemo, useState } from "react";
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
import { useTheme } from "../../lib/theme-context";
import type { ThemeColors } from "../../lib/theme";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default function CreateHouseholdScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);

    const inviteCode = generateInviteCode();
    const displayName =
      user?.user_metadata?.display_name ?? user?.email ?? "Owner";

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
        placeholderTextColor={colors.textMuted}
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      padding: 24,
      backgroundColor: colors.background,
    },
    label: {
      fontSize: 16,
      fontWeight: "600",
      marginBottom: 8,
      marginTop: 16,
      color: colors.text,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 8,
      padding: 14,
      fontSize: 16,
      backgroundColor: colors.surface,
      color: colors.text,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      padding: 16,
      alignItems: "center",
      marginTop: 24,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: "600",
    },
  });
}

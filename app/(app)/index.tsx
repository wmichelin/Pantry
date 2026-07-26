import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme-context";
import type { ThemeColors } from "../../lib/theme";
import ThemePreferencePicker from "../../components/ThemePreferencePicker";

type Membership = {
  household_id: string;
  role: string;
  households: { id: string; name: string; invite_code: string };
};

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("household_members")
        .select("household_id, role, households(id, name, invite_code)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setMembership(data as Membership | null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (loading || !membership) return;
    router.replace({
      pathname: "/(app)/household",
      params: { id: membership.household_id },
    });
  }, [loading, membership, router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (membership) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Welcome to Pantry</Text>
      <Text style={styles.subtext}>
        Create a household or join an existing one to get started.
      </Text>

      <Pressable
        style={styles.button}
        onPress={() => router.push("/(app)/create-household")}
      >
        <Text style={styles.buttonText}>Create Household</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.secondaryButton]}
        onPress={() => router.push("/(app)/join-household")}
      >
        <Text style={[styles.buttonText, styles.secondaryButtonText]}>
          Join with Invite Code
        </Text>
      </Pressable>

      <ThemePreferencePicker />

      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
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
    container: {
      flex: 1,
      justifyContent: "center",
      padding: 24,
      backgroundColor: colors.background,
    },
    heading: {
      fontSize: 28,
      fontWeight: "700",
      textAlign: "center",
      marginBottom: 8,
      color: colors.text,
    },
    subtext: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: "center",
      marginBottom: 40,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      padding: 16,
      alignItems: "center",
      marginBottom: 12,
    },
    secondaryButton: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    buttonText: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: "600",
    },
    secondaryButtonText: {
      color: colors.primary,
    },
    signOut: {
      marginTop: 32,
      alignSelf: "center",
    },
    signOutText: {
      color: colors.textMuted,
      fontSize: 14,
    },
  });
}

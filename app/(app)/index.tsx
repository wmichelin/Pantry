import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { errorMessage } from "../../lib/db";

type Membership = {
  household_id: string;
  role: string;
  households: { id: string; name: string; invite_code: string };
};

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from("household_members")
        .select("household_id, role, households(id, name, invite_code)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setMembership(null);
        setLoadError(errorMessage(error));
        setLoading(false);
        return;
      }
      setMembership(data as Membership | null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [retryAttempt, user?.id]);

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
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (membership) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorHeading}>Couldn’t load your household</Text>
        <Text style={styles.errorMessage}>{loadError}</Text>
        <Pressable style={styles.button} onPress={() => setRetryAttempt((attempt) => attempt + 1)}>
          <Text style={styles.buttonText}>Try Again</Text>
        </Pressable>
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

      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subtext: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 40,
  },
  button: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2f95dc",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButtonText: {
    color: "#2f95dc",
  },
  signOut: {
    marginTop: 32,
    alignSelf: "center",
  },
  signOutText: {
    color: "#999",
    fontSize: 14,
  },
  errorHeading: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  errorMessage: {
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
    paddingHorizontal: 24,
  },
});

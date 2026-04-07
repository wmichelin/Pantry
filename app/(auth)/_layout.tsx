import { Redirect, Stack, useSegments } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { ActivityIndicator, View } from "react-native";

export default function AuthLayout() {
  const { session, loading } = useAuth();
  const segments = useSegments();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Never redirect away from reset-password — setSession is called mid-flight
  // there and we don't want a session-change to bounce the user to /(app).
  const isResetPassword = segments.includes("reset-password");
  if (session && !isResetPassword) {
    return <Redirect href="/(app)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

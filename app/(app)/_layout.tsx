import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { useTheme } from "../../lib/theme-context";
import { ActivityIndicator, View } from "react-native";

export default function AppLayout() {
  const { session, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Pantry" }} />
      <Stack.Screen name="create-household" options={{ title: "New Household" }} />
      <Stack.Screen name="join-household" options={{ title: "Join Household" }} />
      <Stack.Screen name="household" options={{ title: "Household" }} />
      <Stack.Screen name="household-edit" options={{ title: "Edit Household" }} />
      <Stack.Screen name="create-recipe" options={{ title: "New Recipe" }} />
      <Stack.Screen name="recipe/[id]" options={{ title: "Recipe" }} />
      <Stack.Screen name="import-recipe" options={{ title: "Import Recipe" }} />
      <Stack.Screen name="review-recipe" options={{ title: "Review Recipe" }} />
      <Stack.Screen name="review-board" options={{ title: "Review Board" }} />
      <Stack.Screen name="week-queue" options={{ title: "This Week" }} />
      <Stack.Screen name="shopping-list" options={{ title: "Shopping List" }} />
      <Stack.Screen name="ingredients" options={{ title: "Ingredients" }} />
    </Stack>
  );
}

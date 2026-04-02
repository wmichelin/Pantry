import { Slot, useRouter } from "expo-router";
import { useEffect } from "react";
import * as Linking from "expo-linking";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    const handleUrl = async (url: string) => {
      // Supabase sends recovery tokens in the URL fragment:
      // pantry://reset-password#access_token=...&type=recovery
      const fragment = url.split("#")[1];
      if (!fragment) return;

      const params = Object.fromEntries(new URLSearchParams(fragment));
      if (params.type === "recovery" && params.access_token && params.refresh_token) {
        await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        router.push("/(auth)/reset-password");
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <DeepLinkHandler />
        <Slot />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

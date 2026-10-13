import { Modal, Pressable, Text, View } from "react-native";

/** Acknowledgement after a committed save. Retry is reserved for operations
 * with durable idempotency, so ordinary recipe saves cannot be duplicated. */
export function SavedNotice({
  message,
  onContinue,
  onRetry,
  title = "Save result",
  continueLabel = "Continue to recipes",
}: {
  message: string;
  onContinue: () => void;
  onRetry?: () => void;
  title?: string;
  continueLabel?: string;
}) {
  return (
    <Modal visible={!!message} transparent onRequestClose={onContinue}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: "white",
            borderRadius: 12,
            padding: 24,
            gap: 16,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ fontSize: 18, fontWeight: "700" }}
          >
            {title}
          </Text>
          <Text>{message}</Text>
          {onRetry && (
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={{ padding: 12 }}
            >
              <Text style={{ color: "#2f95dc", fontWeight: "600" }}>Retry unsaved recipes</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onContinue}
            style={{ padding: 12 }}
          >
            <Text style={{ color: "#2f95dc" }}>{continueLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export const catalogSavedWarning =
  "Your recipe content was saved, but some ingredients could not be added to the catalog. Use ‘Seed from recipes’ in Ingredients to retry catalog enrichment; do not save the recipe again.";

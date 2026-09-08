import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

/** Visible web/native confirmation. Failure leaves the dialog open for retry. */
export function ConfirmAction({
  visible,
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !busy && onCancel()}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text>{message}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onConfirm}
            style={styles.confirm}
          >
            <Text style={styles.confirmText}>
              {busy ? "Working…" : confirmLabel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onCancel}
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  card: { backgroundColor: "white", padding: 24, borderRadius: 12, gap: 16 },
  title: { fontSize: 18, fontWeight: "700" },
  confirm: {
    backgroundColor: "#d32f2f",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  confirmText: { color: "white", fontWeight: "600" },
  cancel: { textAlign: "center", padding: 8 },
});

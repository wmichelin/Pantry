import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from "react-native";

type Props = {
  activeTags: string[];
  suggestedTags: string[];
  onChange: (tags: string[]) => void;
};

export default function TagEditor({ activeTags, suggestedTags, onChange }: Props) {
  const [input, setInput] = useState("");

  const customTags = activeTags.filter((t) => !suggestedTags.includes(t));

  const toggle = (tag: string) => {
    if (activeTags.includes(tag)) {
      onChange(activeTags.filter((t) => t !== tag));
    } else {
      onChange([...activeTags, tag]);
    }
  };

  const addCustom = () => {
    const tag = input.trim();
    if (!tag || activeTags.includes(tag)) {
      setInput("");
      return;
    }
    onChange([...activeTags, tag]);
    setInput("");
  };

  return (
    <View>
      <View style={styles.pills}>
        {suggestedTags.map((tag) => {
          const selected = activeTags.includes(tag);
          return (
            <Pressable
              key={tag}
              style={[styles.pill, selected && styles.pillSelected]}
              onPress={() => toggle(tag)}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                {tag}
              </Text>
            </Pressable>
          );
        })}
        {customTags.map((tag) => (
          <Pressable
            key={tag}
            style={[styles.pill, styles.pillSelected]}
            onPress={() => toggle(tag)}
          >
            <Text style={[styles.pillText, styles.pillTextSelected]}>
              {tag} ✕
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Add custom tag…"
          placeholderTextColor="#aaa"
          returnKeyType="done"
          onSubmitEditing={addCustom}
        />
        <Pressable style={styles.addButton} onPress={addCustom}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillSelected: {
    backgroundColor: "#2f95dc",
    borderColor: "#2f95dc",
  },
  pillText: {
    fontSize: 13,
    color: "#555",
  },
  pillTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: "#fafafa",
  },
  addButton: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});

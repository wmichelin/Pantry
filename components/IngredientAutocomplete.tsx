import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import type { CatalogIngredient } from "../lib/ingredient-catalog";
import { normalizeIngredient } from "../lib/normalize-ingredient";

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  catalog: CatalogIngredient[];
  onSelect?: (item: CatalogIngredient) => void;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
  /** Exclude these normalized names from suggestions (e.g. already on a form). */
  excludeNormalized?: string[];
} & Pick<TextInputProps, "onSubmitEditing" | "returnKeyType" | "editable">;

const MAX_SUGGESTIONS = 8;

export function IngredientAutocomplete({
  value,
  onChangeText,
  catalog,
  onSelect,
  placeholder = "Ingredient",
  style,
  containerStyle,
  autoFocus,
  excludeNormalized,
  onSubmitEditing,
  returnKeyType,
  editable = true,
}: Props) {
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  const suggestions = useMemo(() => {
    const q = normalizeIngredient(value);
    if (!q || q.length < 1) return [];
    const exclude = new Set(excludeNormalized ?? []);
    return catalog
      .filter((c) => {
        if (exclude.has(c.normalized_name)) return false;
        return (
          c.normalized_name.includes(q) ||
          c.display_name.toLowerCase().includes(q)
        );
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [value, catalog, excludeNormalized]);

  const showDropdown = focused && suggestions.length > 0;

  const pick = (item: CatalogIngredient) => {
    onChangeText(item.display_name);
    onSelect?.(item);
    setFocused(false);
  };

  return (
    <View style={[styles.wrap, containerStyle]}>
      <TextInput
        style={[styles.input, style]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoCorrect={false}
        editable={editable}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setFocused(true);
        }}
        onBlur={() => {
          // Delay so suggestion press can register.
          blurTimer.current = setTimeout(() => setFocused(false), 150);
        }}
      />
      {showDropdown && (
        <View style={styles.dropdown}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={styles.dropdownScroll}
          >
            {suggestions.map((item) => (
              <Pressable
                key={item.id}
                style={styles.suggestion}
                onPress={() => pick(item)}
              >
                <Text style={styles.suggestionText}>{item.display_name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    zIndex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  dropdown: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "100%",
    marginTop: 4,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    maxHeight: 200,
    zIndex: 20,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  dropdownScroll: {
    maxHeight: 200,
  },
  suggestion: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f2f2",
  },
  suggestionText: {
    fontSize: 15,
    color: "#222",
  },
});

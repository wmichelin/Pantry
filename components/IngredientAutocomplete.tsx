import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData,
} from "react-native";
import type { CatalogIngredient } from "../lib/ingredient-catalog";
import { searchableIngredient } from "../lib/normalize-ingredient";

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
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionRefs = useRef<Array<{ scrollIntoView?: (opts?: ScrollIntoViewOptions) => void } | null>>([]);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  const suggestions = useMemo(() => {
    const q = searchableIngredient(value);
    if (!q || q.length < 1) return [];
    const exclude = new Set(excludeNormalized ?? []);
    return catalog
      .filter((c) => {
        if (exclude.has(c.normalized_name)) return false;
        return (
          searchableIngredient(c.normalized_name).includes(q) ||
          searchableIngredient(c.display_name).includes(q)
        );
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [value, catalog, excludeNormalized]);

  const showDropdown = focused && suggestions.length > 0;

  useEffect(() => {
    setHighlightIndex(-1);
    suggestionRefs.current = [];
  }, [value, suggestions.length]);

  useEffect(() => {
    if (highlightIndex < 0) return;
    suggestionRefs.current[highlightIndex]?.scrollIntoView?.({
      block: "nearest",
    });
  }, [highlightIndex]);

  const pick = (item: CatalogIngredient) => {
    onChangeText(item.display_name);
    onSelect?.(item);
    setHighlightIndex(-1);
    setFocused(false);
  };

  const moveHighlight = (delta: number) => {
    if (suggestions.length === 0) return;
    setHighlightIndex((current) => {
      if (current < 0) return delta > 0 ? 0 : suggestions.length - 1;
      const next = current + delta;
      if (next < 0) return suggestions.length - 1;
      if (next >= suggestions.length) return 0;
      return next;
    });
  };

  const handleSubmitEditing = (
    e: NativeSyntheticEvent<TextInputSubmitEditingEventData>
  ) => {
    if (showDropdown && highlightIndex >= 0 && suggestions[highlightIndex]) {
      pick(suggestions[highlightIndex]);
      return;
    }
    onSubmitEditing?.(e);
  };

  const handleKeyDown = (event: { key: string; preventDefault: () => void }) => {
    if (!showDropdown) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveHighlight(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveHighlight(-1);
        break;
      case "Escape":
        event.preventDefault();
        setHighlightIndex(-1);
        setFocused(false);
        break;
      case "Enter":
        if (highlightIndex >= 0 && suggestions[highlightIndex]) {
          event.preventDefault();
          pick(suggestions[highlightIndex]);
        }
        break;
      default:
        break;
    }
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
        onSubmitEditing={handleSubmitEditing}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setFocused(true);
        }}
        onBlur={() => {
          // Delay so suggestion press can register.
          blurTimer.current = setTimeout(() => {
            setFocused(false);
            setHighlightIndex(-1);
          }, 150);
        }}
        // Web: arrow / escape / enter for the suggestion list.
        {...(Platform.OS === "web"
          ? {
              onKeyDown: (e: { nativeEvent?: { key?: string }; key?: string; preventDefault: () => void }) => {
                const key = e.nativeEvent?.key ?? e.key ?? "";
                handleKeyDown({ key, preventDefault: () => e.preventDefault() });
              },
            }
          : {})}
      />
      {showDropdown && (
        <View style={styles.dropdown} accessibilityRole="list">
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={styles.dropdownScroll}
          >
            {suggestions.map((item, index) => (
              <Pressable
                key={item.id}
                ref={(node) => {
                  suggestionRefs.current[index] = node as {
                    scrollIntoView?: (opts?: ScrollIntoViewOptions) => void;
                  } | null;
                }}
                style={[
                  styles.suggestion,
                  index === highlightIndex && styles.suggestionHighlighted,
                ]}
                onPress={() => pick(item)}
                onHoverIn={() => setHighlightIndex(index)}
              >
                <Text
                  style={[
                    styles.suggestionText,
                    index === highlightIndex && styles.suggestionTextHighlighted,
                  ]}
                >
                  {item.display_name}
                </Text>
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
  suggestionHighlighted: {
    backgroundColor: "#eaf4fc",
  },
  suggestionText: {
    fontSize: 15,
    color: "#222",
  },
  suggestionTextHighlighted: {
    color: "#1a6fa8",
    fontWeight: "600",
  },
});

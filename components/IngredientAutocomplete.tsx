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
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
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

type KeyEventLike = {
  key?: string;
  nativeEvent?: { key?: string };
  preventDefault?: () => void;
  isDefaultPrevented?: () => boolean;
};

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
  // Keep latest nav state for key handlers (RN Web calls onKeyPress from its
  // internal onKeyDown — custom onKeyDown props are overwritten and ignored).
  const navRef = useRef({
    showDropdown: false,
    highlightIndex: -1,
    suggestions: [] as CatalogIngredient[],
  });

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
  navRef.current = { showDropdown, highlightIndex, suggestions };

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
    const { suggestions: list } = navRef.current;
    if (list.length === 0) return;
    setHighlightIndex((current) => {
      if (current < 0) return delta > 0 ? 0 : list.length - 1;
      const next = current + delta;
      if (next < 0) return list.length - 1;
      if (next >= list.length) return 0;
      return next;
    });
  };

  const handleNavKey = (event: KeyEventLike) => {
    const { showDropdown: open, highlightIndex: index, suggestions: list } =
      navRef.current;
    if (!open) return false;

    const key = event.key ?? event.nativeEvent?.key ?? "";
    const prevent = () => event.preventDefault?.();

    switch (key) {
      case "ArrowDown":
        prevent();
        moveHighlight(1);
        return true;
      case "ArrowUp":
        prevent();
        moveHighlight(-1);
        return true;
      case "Escape":
        prevent();
        setHighlightIndex(-1);
        setFocused(false);
        return true;
      case "Enter":
        if (index >= 0 && list[index]) {
          // Must preventDefault so RN Web skips onSubmitEditing / blur-on-submit.
          prevent();
          pick(list[index]);
          return true;
        }
        return false;
      default:
        return false;
    }
  };

  const handleKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>
  ) => {
    handleNavKey(e as unknown as KeyEventLike);
  };

  const handleSubmitEditing = (
    e: NativeSyntheticEvent<TextInputSubmitEditingEventData>
  ) => {
    const { showDropdown: open, highlightIndex: index, suggestions: list } =
      navRef.current;
    if (open && index >= 0 && list[index]) {
      pick(list[index]);
      return;
    }
    onSubmitEditing?.(e);
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
        onKeyPress={handleKeyPress}
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

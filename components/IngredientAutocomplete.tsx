import { useEffect, useMemo, useRef, useState, type Ref } from "react";
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
import { useTheme } from "../lib/theme-context";
import type { ThemeColors } from "../lib/theme";

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  catalog: CatalogIngredient[];
  onSelect?: (item: CatalogIngredient) => void;
  /**
   * When false, selecting a suggestion does not write into the input first
   * (parent commits immediately — e.g. shopping list add). Default true.
   */
  fillOnSelect?: boolean;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
  inputRef?: Ref<TextInput>;
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

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else ref.current = value;
}

export function IngredientAutocomplete({
  value,
  onChangeText,
  catalog,
  onSelect,
  fillOnSelect = true,
  placeholder = "Ingredient",
  style,
  containerStyle,
  autoFocus,
  inputRef,
  excludeNormalized,
  onSubmitEditing,
  returnKeyType,
  editable = true,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localInputRef = useRef<TextInput | null>(null);
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

  const clearBlurTimer = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  };

  const pick = (item: CatalogIngredient) => {
    clearBlurTimer();
    setHighlightIndex(-1);
    if (fillOnSelect) {
      onChangeText(item.display_name);
      setFocused(false);
    } else {
      // Parent commits immediately — keep focus so the next keystroke shows suggestions.
      setFocused(true);
    }
    onSelect?.(item);
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
        ref={(node) => {
          localInputRef.current = node;
          assignRef(inputRef, node);
        }}
        style={[styles.input, style]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoFocus={autoFocus}
        autoCorrect={false}
        editable={editable}
        returnKeyType={returnKeyType}
        onSubmitEditing={handleSubmitEditing}
        onKeyPress={handleKeyPress}
        blurOnSubmit={false}
        onFocus={() => {
          clearBlurTimer();
          setFocused(true);
        }}
        onBlur={() => {
          // Delay so suggestion press can register. Ignore stale blurs after we
          // re-focus for continuous add (Enter-to-add → focus stays on input).
          clearBlurTimer();
          blurTimer.current = setTimeout(() => {
            if (localInputRef.current?.isFocused()) return;
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      position: "relative",
      zIndex: 1,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      backgroundColor: colors.surface,
      color: colors.text,
    },
    dropdown: {
      position: "absolute",
      left: 0,
      right: 0,
      top: "100%",
      marginTop: 4,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.borderStrong,
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
      borderBottomColor: colors.border,
    },
    suggestionHighlighted: {
      backgroundColor: colors.primarySoft,
    },
    suggestionText: {
      fontSize: 15,
      color: colors.text,
    },
    suggestionTextHighlighted: {
      color: colors.primary,
      fontWeight: "600",
    },
  });
}

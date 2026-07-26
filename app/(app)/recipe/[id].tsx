import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Pressable,
  Image,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth-context";
import { showError, throwOnError } from "../../../lib/db";
import { useTheme } from "../../../lib/theme-context";
import type { ThemeColors } from "../../../lib/theme";
import { formatQuantity } from "../../../lib/format-quantity";
import TagEditor from "../../../components/TagEditor";

type Recipe = {
  id: string;
  title: string;
  created_at: string;
  source_type: string | null;
  household_id: string;
  source_url: string | null;
  image_url: string | null;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  instructions: string[] | null;
  tags: string[] | null;
};
type Ingredient = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
};

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [queued, setQueued] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueChecked, setQueueChecked] = useState(false);
  const [editingTags, setEditingTags] = useState<string[] | null>(null);
  const [savingTags, setSavingTags] = useState(false);
  const [allKnownTags, setAllKnownTags] = useState<string[]>([]);

  useEffect(() => {
    loadRecipe();
  }, [id]);

  const loadRecipe = async () => {
    try {
      const [rRes, iRes] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, title, created_at, source_type, source_url, household_id, image_url, servings, prep_time_minutes, cook_time_minutes, instructions, tags")
          .eq("id", id)
          .single(),
        supabase.from("recipe_ingredients").select("id, name, quantity, unit").eq("recipe_id", id),
      ]);

      if (rRes.error) throw rRes.error;
      setRecipe(rRes.data);
      const [qRes, tRes] = await Promise.all([
        supabase
          .from("week_queues")
          .select("id")
          .eq("household_id", rRes.data.household_id)
          .eq("recipe_id", id)
          .maybeSingle(),
        supabase
          .from("recipes")
          .select("tags")
          .eq("household_id", rRes.data.household_id),
      ]);
      setQueued(!!qRes.data);
      setQueueChecked(true);
      if (tRes.data) {
        setAllKnownTags([...new Set(tRes.data.flatMap((r) => r.tags ?? []))].sort());
      }
      if (iRes.data) setIngredients(iRes.data);
    } catch (err) {
      showError("Couldn't load recipe", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!recipe) return;
    try {
      throwOnError(await supabase.from("recipe_ingredients").delete().eq("recipe_id", id));
      throwOnError(await supabase.from("recipes").delete().eq("id", id));
      router.replace({ pathname: "/(app)/household", params: { id: recipe.household_id } });
    } catch (err) {
      setConfirmDelete(false);
      showError("Couldn't delete recipe", err);
    }
  };

  const handleQueueToggle = async () => {
    if (!recipe) return;
    setQueueLoading(true);
    try {
      if (queued) {
        throwOnError(
          await supabase
            .from("week_queues")
            .delete()
            .eq("household_id", recipe.household_id)
            .eq("recipe_id", recipe.id)
        );
        setQueued(false);
      } else {
        throwOnError(
          await supabase.from("week_queues").insert({
            household_id: recipe.household_id,
            recipe_id: recipe.id,
            added_by: user!.id,
          })
        );
        setQueued(true);
      }
    } catch (err) {
      showError("Couldn't update the queue", err);
    } finally {
      setQueueLoading(false);
    }
  };

  const handleSaveTags = async () => {
    if (editingTags === null) return;
    setSavingTags(true);
    try {
      throwOnError(await supabase.from("recipes").update({ tags: editingTags }).eq("id", id));
      setRecipe((prev) => (prev ? { ...prev, tags: editingTags } : prev));
      setEditingTags(null);
    } catch (err) {
      showError("Couldn't save tags", err);
    } finally {
      setSavingTags(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!recipe) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFoundText}>Recipe not found.</Text>
      </View>
    );
  }

  const isImported = recipe.source_type === "url" || recipe.source_type === "pinterest_pin";

  const extractStepText = (step: string): string => {
    try {
      const parsed = JSON.parse(step);
      if (parsed && typeof parsed.text === "string") return parsed.text;
    } catch {}
    const m = step.match(/['"]text['"]\s*:\s*['"](.+)/s);
    if (m) return m[1].replace(/['"]\s*[,}]?\s*$/, "").trim();
    return step;
  };

  const formatIngredient = (ing: Ingredient) => {
    const parts: string[] = [];
    if (ing.quantity) parts.push(formatQuantity(ing.quantity));
    if (ing.unit) parts.push(ing.unit);
    parts.push(ing.name);
    return parts.join(" ");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {recipe.image_url && (
        <Image source={{ uri: recipe.image_url }} style={styles.image} />
      )}

      <Text style={styles.title}>{recipe.title}</Text>

      {recipe.source_url && (
        <Pressable onPress={() => Linking.openURL(recipe.source_url!)}>
          <Text style={styles.sourceLink}>View original recipe ↗</Text>
        </Pressable>
      )}

      {(recipe.servings || recipe.prep_time_minutes || recipe.cook_time_minutes) && (
        <View style={styles.metaRow}>
          {recipe.servings && (
            <Text style={styles.meta}>🍽 {recipe.servings} servings</Text>
          )}
          {recipe.prep_time_minutes && (
            <Text style={styles.meta}>⏱ {recipe.prep_time_minutes}m prep</Text>
          )}
          {recipe.cook_time_minutes && (
            <Text style={styles.meta}>🔥 {recipe.cook_time_minutes}m cook</Text>
          )}
        </View>
      )}

      <View style={styles.tagsSection}>
        {editingTags !== null ? (
          <View style={styles.tagEditorWrap}>
            <TagEditor
              activeTags={editingTags}
              suggestedTags={allKnownTags}
              onChange={setEditingTags}
            />
            <View style={styles.tagEditActions}>
              <Pressable
                style={[styles.saveTagsButton, savingTags && styles.buttonDisabled]}
                onPress={handleSaveTags}
                disabled={savingTags}
              >
                <Text style={styles.saveTagsText}>{savingTags ? "Saving…" : "Save"}</Text>
              </Pressable>
              <Pressable onPress={() => setEditingTags(null)}>
                <Text style={styles.cancelTagsText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.tagsRow}>
            <View style={styles.tags}>
              {recipe.tags && recipe.tags.length > 0 ? (
                recipe.tags.map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.noTagsHint}>No tags</Text>
              )}
            </View>
            <Pressable onPress={() => setEditingTags(recipe.tags ?? [])}>
              <Text style={styles.editTagsLink}>Edit tags</Text>
            </Pressable>
          </View>
        )}
      </View>

      {queueChecked && (
        <Pressable
          style={[styles.queueButton, queued && styles.queueButtonActive]}
          onPress={handleQueueToggle}
          disabled={queueLoading}
        >
          <Text style={[styles.queueButtonText, queued && styles.queueButtonTextActive]}>
            {queued ? "✓ In queue" : "+ Add to queue"}
          </Text>
        </Pressable>
      )}

      <Text style={styles.sectionTitle}>
        Ingredients ({ingredients.length})
      </Text>
      {ingredients.length === 0 ? (
        <Text style={styles.emptyText}>
          {isImported
            ? "No ingredients were found when this recipe was imported."
            : "No ingredients added yet."}
        </Text>
      ) : (
        ingredients.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.bullet}>{"\u2022"}</Text>
            <Text style={styles.rowText}>{formatIngredient(item)}</Text>
          </View>
        ))
      )}

      {recipe.instructions && recipe.instructions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Instructions</Text>
          {recipe.instructions.map((step, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.stepNumber}>{i + 1}.</Text>
              <Text style={styles.rowText}>{extractStepText(step)}</Text>
            </View>
          ))}
        </>
      )}

      {confirmDelete ? (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>Delete this recipe?</Text>
          <View style={styles.confirmButtons}>
            <Pressable onPress={handleDelete}>
              <Text style={styles.deleteText}>Yes, delete</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmDelete(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.deleteButton} onPress={() => setConfirmDelete(true)}>
          <Text style={styles.deleteText}>Delete Recipe</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
  notFoundText: {
    color: colors.text,
    fontSize: 16,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 48,
  },
  image: {
    width: "100%",
    height: 220,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 12,
    paddingHorizontal: 24,
    color: colors.text,
  },
  sourceLink: {
    fontSize: 14,
    color: colors.primary,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: "row",
    gap: 16,
    flexWrap: "wrap",
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  meta: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  tagsSection: {
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },
  noTagsHint: {
    fontSize: 12,
    color: colors.textMuted,
  },
  editTagsLink: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "600",
    marginLeft: 8,
    marginTop: 2,
  },
  tagEditorWrap: {
    // TagEditor has no built-in padding; section provides horizontal padding
  },
  tagEditActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
    alignItems: "center",
  },
  saveTagsButton: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  saveTagsText: {
    color: colors.primaryText,
    fontWeight: "600",
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  cancelTagsText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  tag: {
    backgroundColor: colors.primarySoft,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "600",
  },
  queueButton: {
    marginHorizontal: 24,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  queueButtonActive: {
    backgroundColor: colors.success,
  },
  queueButtonText: {
    color: colors.success,
    fontWeight: "600",
    fontSize: 15,
  },
  queueButtonTextActive: {
    color: colors.primaryText,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    marginTop: 24,
    paddingHorizontal: 24,
    color: colors.text,
  },
  emptyText: {
    color: colors.textMuted,
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 24,
    gap: 8,
  },
  bullet: {
    fontSize: 16,
    color: colors.primary,
    marginTop: 2,
  },
  stepNumber: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: "600",
    marginTop: 2,
    minWidth: 20,
  },
  rowText: {
    fontSize: 15,
    flex: 1,
    lineHeight: 22,
    color: colors.text,
  },
  deleteButton: {
    marginTop: 40,
    alignSelf: "center",
  },
  deleteText: {
    color: colors.danger,
    fontSize: 14,
  },
  confirmRow: {
    marginTop: 40,
    alignItems: "center",
    gap: 12,
  },
  confirmText: {
    fontSize: 14,
    color: colors.text,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: 24,
  },
  cancelText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  });
}

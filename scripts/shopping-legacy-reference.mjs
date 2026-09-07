// Independent characterization of the former screen aggregation (before its
// metadata side effect). Preserve JS semantics; never call the Go implementation.
export function legacyShopping(snapshot) {
  const metadata = new Map(snapshot.catalog.map(m => [m.normalized_name, m]));
  const checks = new Set(snapshot.checks);
  const grouped = new Map();
  const base = (name, key) => {
    const m = metadata.get(name);
    return { list_key: key, normalized_name: name, display_name: m?.display_name ?? name.replace(/\b\w/g, c => c.toUpperCase()), metadata_id: m?.id ?? '', sort_order: m?.sort_order ?? null, category: m?.category?.trim() || 'other', occurrences: [], checked: false, is_manual: false, manual_item_id: '' };
  };
  for (const ingredient of snapshot.ingredients) {
    const name = ingredient.name.toLowerCase().trim();
    if (name.endsWith(':')) continue;
    const key = 'recipe:' + name;
    let row = grouped.get(key);
    if (!row) { row = base(name, key); row.checked = checks.has(name); grouped.set(key, row); }
    row.occurrences.push({ recipe_title: ingredient.recipe_title, quantity: ingredient.quantity, unit: ingredient.unit });
  }
  for (const manual of snapshot.manuals) {
    const name = manual.normalized_name, recipe = grouped.get('recipe:' + name);
    const occurrence = { recipe_title: 'Added', quantity: manual.quantity, unit: manual.unit };
    if (recipe && manual.unit?.trim()) { recipe.occurrences.push(occurrence); recipe.is_manual = true; recipe.manual_item_id = manual.id; continue; }
    const row = base(name, 'manual:' + manual.id);
    row.sort_order = manual.sort_order ?? row.sort_order;
    row.is_manual = true; row.manual_item_id = manual.id;
    row.checked = checks.has(name + '::manual') || (!recipe && checks.has(name));
    if (manual.quantity != null || manual.unit) row.occurrences.push(occurrence);
    grouped.set(row.list_key, row);
  }
  return [...grouped.values()].sort((a,b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
}

/** Insert-before index helpers for web SortableList. */

/** Insert-before index in 0..rows.length (length = after last). */
export function insertionIndexFromY(
  clientY: number,
  rows: { getBoundingClientRect: () => { top: number; height: number } }[]
): number {
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length;
}

/** Move `from` so it sits before `insertBefore` in the original list (0..length). */
export function moveItemBefore<T>(items: T[], from: number, insertBefore: number): T[] {
  if (from < 0 || from >= items.length) return items;
  let to = Math.max(0, Math.min(insertBefore, items.length));
  // Already in that slot (before self, or before the next item).
  if (to === from || to === from + 1) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (from < to) to -= 1;
  next.splice(to, 0, moved);
  return next;
}

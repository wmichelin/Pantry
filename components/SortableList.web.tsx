import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web sortable list via Pointer Events (mouse + touch).
 *
 * HTML5 DnD + touch polyfills are unreliable under React Native Web (Pressables
 * preventDefault synthetic mouse/drag events). Pointer events are the dependable path.
 *
 * Touch/pen: press-hold ~180ms, then drag (quick swipe still scrolls).
 * Mouse: drag after a few pixels of movement.
 */

type Props<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, drag?: () => void, isActive?: boolean) => React.ReactNode;
  onReorder: (items: T[]) => void;
};

const HOLD_MS = 180;
const HOLD_MOVE_CANCEL_PX = 12;
const MOUSE_ACTIVATE_PX = 6;

function isNoDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest("[data-no-drag]");
}

/** Destination index for splice(from,1)+splice(to,0) based on pointer Y. */
function indexFromY(clientY: number, listEl: HTMLElement): number {
  const rows = Array.from(listEl.querySelectorAll<HTMLElement>("[data-sortable-id]"));
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length - 1;
}

export function SortableList<T>({ items, keyExtractor, renderItem, onReorder }: Props<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  const onReorderRef = useRef(onReorder);
  itemsRef.current = items;
  onReorderRef.current = onReorder;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{
    html: string;
    width: number;
    height: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const sessionRef = useRef<{
    pointerId: number;
    startIndex: number;
    id: string;
    startX: number;
    startY: number;
    activated: boolean;
    holdTimer: ReturnType<typeof setTimeout> | null;
    rowEl: HTMLElement;
    pointerType: string;
  } | null>(null);

  const cleanup = useCallback(() => {
    const s = sessionRef.current;
    if (s?.holdTimer) clearTimeout(s.holdTimer);
    if (s?.rowEl) s.rowEl.style.touchAction = "";
    sessionRef.current = null;
    setActiveId(null);
    setOverIndex(null);
    setGhost(null);
  }, []);

  const activate = useCallback((clientX: number, clientY: number) => {
    const s = sessionRef.current;
    if (!s || s.activated) return;
    s.activated = true;
    if (s.holdTimer) {
      clearTimeout(s.holdTimer);
      s.holdTimer = null;
    }

    const rect = s.rowEl.getBoundingClientRect();
    setActiveId(s.id);
    setOverIndex(s.startIndex);
    setGhost({
      html: s.rowEl.innerHTML,
      width: rect.width,
      height: rect.height,
      x: clientX,
      y: clientY,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
    });
    s.rowEl.style.touchAction = "none";
    try {
      s.rowEl.setPointerCapture(s.pointerId);
    } catch {
      /* pointer may already be up */
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const onPointerDown = (e: React.PointerEvent, index: number, id: string, rowEl: HTMLElement) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (isNoDragTarget(e.target)) return;
    if (sessionRef.current) return;

    sessionRef.current = {
      pointerId: e.pointerId,
      startIndex: index,
      id,
      startX: e.clientX,
      startY: e.clientY,
      activated: false,
      holdTimer: null,
      rowEl,
      pointerType: e.pointerType,
    };

    if (e.pointerType === "touch" || e.pointerType === "pen") {
      sessionRef.current.holdTimer = setTimeout(() => {
        const s = sessionRef.current;
        if (!s || s.activated) return;
        activate(s.startX, s.startY);
      }, HOLD_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = sessionRef.current;
    if (!s || e.pointerId !== s.pointerId) return;

    const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);

    if (!s.activated) {
      if (s.pointerType === "touch" || s.pointerType === "pen") {
        if (dist > HOLD_MOVE_CANCEL_PX) cleanup();
        return;
      }
      if (dist < MOUSE_ACTIVATE_PX) return;
      activate(e.clientX, e.clientY);
    }

    if (!sessionRef.current?.activated) return;

    e.preventDefault();
    const listEl = listRef.current;
    if (!listEl) return;

    setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g));
    setOverIndex(indexFromY(e.clientY, listEl));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = sessionRef.current;
    if (!s || e.pointerId !== s.pointerId) return;

    const listEl = listRef.current;
    if (s.activated && listEl) {
      const from = s.startIndex;
      const to = indexFromY(e.clientY, listEl);
      if (from !== to) {
        const next = [...itemsRef.current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onReorderRef.current(next);
      }
      try {
        s.rowEl.releasePointerCapture(s.pointerId);
      } catch {
        /* ignore */
      }
    }
    cleanup();
  };

  return (
    <div
      ref={listRef}
      style={{ overflowY: "auto", flex: 1, position: "relative" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cleanup}
    >
      {items.map((item, index) => {
        const id = keyExtractor(item);
        const isActive = activeId === id;
        const showLine =
          overIndex !== null &&
          activeId !== null &&
          !isActive &&
          overIndex === index;

        return (
          <div
            key={id}
            data-sortable-id={id}
            onPointerDown={(e) => onPointerDown(e, index, id, e.currentTarget)}
            style={{
              position: "relative",
              opacity: isActive ? 0.35 : 1,
              boxSizing: "border-box",
              cursor: "grab",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
              touchAction: "pan-y",
            }}
          >
            {showLine ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  height: 3,
                  backgroundColor: "#2f95dc",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />
            ) : null}
            {renderItem(item, undefined, isActive)}
          </div>
        );
      })}

      {ghost ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: ghost.x - ghost.offsetX,
            top: ghost.y - ghost.offsetY,
            width: ghost.width,
            height: ghost.height,
            opacity: 0.92,
            pointerEvents: "none",
            zIndex: 99999,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            backgroundColor: "#fff",
            overflow: "hidden",
          }}
          dangerouslySetInnerHTML={{ __html: ghost.html }}
        />
      ) : null}
    </div>
  );
}

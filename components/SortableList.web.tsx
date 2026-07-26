import React, { useCallback, useEffect, useRef, useState } from "react";
import { insertionIndexFromY, moveItemBefore } from "../lib/sortable-reorder";

/**
 * Web sortable list via Pointer Events.
 *
 * Mobile / coarse pointer: drag from the ≡ handle only (immediate, no press-hold).
 * Desktop mouse: drag from the whole row after a small move threshold —
 * except when nestedInScroll, which is always handle-only so parent scroll wins.
 */

type Props<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, drag?: () => void, isActive?: boolean) => React.ReactNode;
  onReorder: (items: T[]) => void;
  /** When true, list grows with content and parent scroll owns scrolling (e.g. ScrollView). */
  nestedInScroll?: boolean;
};

const MOUSE_ACTIVATE_PX = 4;

function isDragHandleTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest("[data-drag-handle]");
}

function isNoDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest("[data-no-drag]");
}

function lockAncestorScroll(fromEl: HTMLElement | null): () => void {
  if (!fromEl || typeof document === "undefined") return () => {};
  const locked: { el: HTMLElement; overflow: string; overflowY: string }[] = [];
  let el: HTMLElement | null = fromEl;
  while (el) {
    const style = window.getComputedStyle(el);
    const oy = style.overflowY;
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      locked.push({
        el,
        overflow: el.style.overflow,
        overflowY: el.style.overflowY,
      });
      el.style.overflow = "hidden";
      el.style.overflowY = "hidden";
    }
    el = el.parentElement;
  }
  const prevUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = "none";
  return () => {
    for (const entry of locked) {
      entry.el.style.overflow = entry.overflow;
      entry.el.style.overflowY = entry.overflowY;
    }
    document.body.style.userSelect = prevUserSelect;
  };
}

function rowsFromList(listEl: HTMLElement) {
  return Array.from(listEl.querySelectorAll<HTMLElement>("[data-sortable-id]"));
}

/** Phones / Chrome device-mode: no hover. Keeps desktop mouse whole-row drag. */
function useMobileDragUi(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: none), (pointer: coarse)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

export function SortableList<T>({
  items,
  keyExtractor,
  renderItem,
  onReorder,
  nestedInScroll = false,
}: Props<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  const onReorderRef = useRef(onReorder);
  itemsRef.current = items;
  onReorderRef.current = onReorder;

  const mobileUi = useMobileDragUi();
  // Nested in a page ScrollView: always require the handle so scrolling stays reliable.
  const showHandle = mobileUi || nestedInScroll;

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
    fromHandle: boolean;
    rowEl: HTMLElement;
  } | null>(null);

  const unlockScrollRef = useRef<(() => void) | null>(null);
  const detachDocRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    const s = sessionRef.current;
    if (s?.rowEl) s.rowEl.style.touchAction = "";
    sessionRef.current = null;
    setActiveId(null);
    setOverIndex(null);
    setGhost(null);
    unlockScrollRef.current?.();
    unlockScrollRef.current = null;
    detachDocRef.current?.();
    detachDocRef.current = null;
  }, []);

  const activate = useCallback((clientX: number, clientY: number) => {
    const s = sessionRef.current;
    if (!s || s.activated) return;
    s.activated = true;

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
    unlockScrollRef.current = lockAncestorScroll(listRef.current);
    try {
      s.rowEl.setPointerCapture(s.pointerId);
    } catch {
      /* pointer may already be up */
    }
  }, []);

  const onDocPointerMove = useCallback(
    (e: PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;

      if (!s.activated) {
        const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
        if (dist < MOUSE_ACTIVATE_PX) return;
        activate(e.clientX, e.clientY);
      }

      if (!sessionRef.current?.activated) return;

      e.preventDefault();
      const listEl = listRef.current;
      if (!listEl) return;

      setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g));
      setOverIndex(insertionIndexFromY(e.clientY, rowsFromList(listEl)));
    },
    [activate]
  );

  const onDocPointerUp = useCallback(
    (e: PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;

      const listEl = listRef.current;
      if (s.activated && listEl) {
        const from = s.startIndex;
        const insertBefore = insertionIndexFromY(e.clientY, rowsFromList(listEl));
        const next = moveItemBefore(itemsRef.current, from, insertBefore);
        if (next !== itemsRef.current) {
          onReorderRef.current(next);
        }
        try {
          s.rowEl.releasePointerCapture(s.pointerId);
        } catch {
          /* ignore */
        }
      }
      cleanup();
    },
    [cleanup]
  );

  const attachDocListeners = useCallback(() => {
    detachDocRef.current?.();
    const move = onDocPointerMove;
    const up = onDocPointerUp;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    detachDocRef.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [onDocPointerMove, onDocPointerUp]);

  useEffect(() => () => cleanup(), [cleanup]);

  const onPointerDown = (e: React.PointerEvent, index: number, id: string, rowEl: HTMLElement) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (isNoDragTarget(e.target)) return;
    if (sessionRef.current) return;

    const touchLike =
      showHandle || e.pointerType === "touch" || e.pointerType === "pen";
    const fromHandle = isDragHandleTarget(e.target);

    // Handle-only modes: ignore presses on the row body.
    if (touchLike && !fromHandle) return;

    sessionRef.current = {
      pointerId: e.pointerId,
      startIndex: index,
      id,
      startX: e.clientX,
      startY: e.clientY,
      activated: false,
      fromHandle,
      rowEl,
    };

    attachDocListeners();

    // Handle: grab immediately. Mouse whole-row: wait for a few pixels.
    if (fromHandle) {
      e.preventDefault();
      activate(e.clientX, e.clientY);
    }
  };

  const rowCount = items.length;
  const dropIsNoOp =
    overIndex !== null &&
    activeId !== null &&
    (() => {
      const from = items.findIndex((it) => keyExtractor(it) === activeId);
      if (from < 0 || overIndex === null) return true;
      return overIndex === from || overIndex === from + 1;
    })();

  return (
    <div
      ref={listRef}
      style={
        nestedInScroll
          ? { overflowY: "visible", position: "relative" }
          : { overflowY: "auto", flex: 1, position: "relative" }
      }
    >
      {items.map((item, index) => {
        const id = keyExtractor(item);
        const isActive = activeId === id;
        const showLineTop =
          overIndex !== null &&
          activeId !== null &&
          !dropIsNoOp &&
          overIndex === index;
        const showLineBottom =
          overIndex !== null &&
          activeId !== null &&
          !dropIsNoOp &&
          overIndex === rowCount &&
          index === rowCount - 1;

        return (
          <div
            key={id}
            data-sortable-id={id}
            onPointerDown={(e) => onPointerDown(e, index, id, e.currentTarget)}
            style={{
              position: "relative",
              opacity: isActive ? 0.35 : 1,
              boxSizing: "border-box",
              cursor: showHandle ? "default" : "grab",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
              touchAction: showHandle ? "pan-y" : "pan-y",
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
            }}
          >
            {showLineTop ? (
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
            {showLineBottom ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 3,
                  backgroundColor: "#2f95dc",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>{renderItem(item, undefined, isActive)}</div>
            {showHandle ? (
              <div
                data-drag-handle
                role="button"
                aria-label="Drag to reorder"
                style={{
                  flexShrink: 0,
                  width: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "grab",
                  touchAction: "none",
                  color: "#bbb",
                  fontSize: 20,
                  lineHeight: 1,
                  userSelect: "none",
                }}
              >
                ≡
              </div>
            ) : null}
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

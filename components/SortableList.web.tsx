import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../lib/theme-context";

/**
 * Web sortable list via Pointer Events.
 *
 * Mobile / coarse pointer: drag from the ≡ handle only (immediate, no press-hold).
 * Desktop mouse: drag from the whole row after a small move threshold.
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

function indexFromY(clientY: number, listEl: HTMLElement): number {
  const rows = Array.from(listEl.querySelectorAll<HTMLElement>("[data-sortable-id]"));
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length - 1;
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
  const { colors } = useTheme();
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  const onReorderRef = useRef(onReorder);
  itemsRef.current = items;
  onReorderRef.current = onReorder;

  const showHandle = useMobileDragUi();

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

  const cleanup = useCallback(() => {
    const s = sessionRef.current;
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

    const touchLike =
      showHandle || e.pointerType === "touch" || e.pointerType === "pen";
    const fromHandle = isDragHandleTarget(e.target);

    // Mobile: only the handle starts a drag. Desktop mouse: whole row.
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

    // Handle (mobile): grab immediately. Mouse row: wait for a few pixels.
    if (fromHandle) {
      e.preventDefault();
      activate(e.clientX, e.clientY);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
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
      style={
        nestedInScroll
          ? { overflowY: "visible", position: "relative" }
          : { overflowY: "auto", flex: 1, position: "relative" }
      }
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
              cursor: showHandle ? "default" : "grab",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
              touchAction: "pan-y",
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
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
                  backgroundColor: colors.primary,
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
                  color: colors.textMuted,
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
            backgroundColor: colors.background,
            overflow: "hidden",
          }}
          dangerouslySetInnerHTML={{ __html: ghost.html }}
        />
      ) : null}
    </div>
  );
}

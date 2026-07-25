import React, { useEffect, useRef, useState } from "react";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { reorder } from "@atlaskit/pragmatic-drag-and-drop/reorder";
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index";
// Vendored without `import.meta` — Expo web serves a classic script, so the npm
// package's ESM autoload footer breaks the entire app bundle at parse time.
import { enableDragDropTouch } from "../lib/drag-drop-touch.js";

const ITEM_TYPE = "sortable-item";

type ItemData = {
  type: typeof ITEM_TYPE;
  index: number;
  id: string;
};

function isItemData(data: Record<string | symbol, unknown>): data is ItemData {
  return data.type === ITEM_TYPE;
}

type Props<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, drag?: () => void, isActive?: boolean) => React.ReactNode;
  onReorder: (items: T[]) => void;
};

type RowProps<T> = {
  item: T;
  index: number;
  id: string;
  renderItem: Props<T>["renderItem"];
};

function SortableRow<T>({ item, index, id, renderItem }: RowProps<T>) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  useEffect(() => {
    const element = rowRef.current;
    const dragHandle = handleRef.current;
    if (!element || !dragHandle) return;

    return combine(
      draggable({
        element,
        dragHandle,
        getInitialData: (): ItemData => ({ type: ITEM_TYPE, index, id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => isItemData(source.data) && source.data.id !== id,
        getData: ({ input }) =>
          attachClosestEdge(
            { type: ITEM_TYPE, index, id },
            { element, input, allowedEdges: ["top", "bottom"] }
          ),
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      })
    );
  }, [index, id]);

  return (
    <div
      ref={rowRef}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        opacity: dragging ? 0.4 : 1,
        boxSizing: "border-box",
      }}
    >
      <div
        ref={handleRef}
        style={{
          paddingRight: 10,
          paddingTop: 2,
          cursor: "grab",
          userSelect: "none",
          WebkitUserSelect: "none",
          touchAction: "none",
          lineHeight: 1,
        }}
        aria-label="Drag to reorder"
      >
        <span style={{ fontSize: 20, color: "#bbb" }}>≡</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{renderItem(item, undefined, dragging)}</div>
      {closestEdge ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 3,
            backgroundColor: "#2f95dc",
            pointerEvents: "none",
            top: closestEdge === "top" ? 0 : undefined,
            bottom: closestEdge === "bottom" ? 0 : undefined,
          }}
        />
      ) : null}
    </div>
  );
}

export function SortableList<T>({ items, keyExtractor, renderItem, onReorder }: Props<T>) {
  const itemsRef = useRef(items);
  const onReorderRef = useRef(onReorder);
  itemsRef.current = items;
  onReorderRef.current = onReorder;

  useEffect(() => {
    enableDragDropTouch();
  }, []);

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => isItemData(source.data),
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;
        if (!isItemData(source.data) || !isItemData(target.data)) return;

        const startIndex = source.data.index;
        const indexOfTarget = target.data.index;
        const closestEdgeOfTarget = extractClosestEdge(target.data);
        const finishIndex = getReorderDestinationIndex({
          startIndex,
          indexOfTarget,
          closestEdgeOfTarget,
          axis: "vertical",
        });
        if (startIndex === finishIndex) return;

        onReorderRef.current(
          reorder({
            list: itemsRef.current,
            startIndex,
            finishIndex,
          })
        );
      },
    });
  }, []);

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {items.map((item, index) => {
        const id = keyExtractor(item);
        return (
          <SortableRow
            key={id}
            item={item}
            index={index}
            id={id}
            renderItem={renderItem}
          />
        );
      })}
    </div>
  );
}

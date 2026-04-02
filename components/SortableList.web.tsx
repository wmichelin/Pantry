import React, { useState } from "react";

type Props<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  onReorder: (items: T[]) => void;
};

export function SortableList<T>({ items, keyExtractor, renderItem, onReorder }: Props<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {items.map((item, index) => (
        <div
          key={keyExtractor(item)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(index));
            setDragIndex(index);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverIndex(index);
          }}
          onDragLeave={() => setDragOverIndex(null)}
          onDrop={(e) => {
            e.preventDefault();
            const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
            if (from === index) { setDragOverIndex(null); return; }
            const next = [...items];
            const [moved] = next.splice(from, 1);
            next.splice(index, 0, moved);
            onReorder(next);
            setDragIndex(null);
            setDragOverIndex(null);
          }}
          onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
          style={{
            cursor: "grab",
            opacity: dragIndex === index ? 0.4 : 1,
            borderLeft: dragOverIndex === index ? "3px solid #2f95dc" : "3px solid transparent",
            boxSizing: "border-box",
          }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}

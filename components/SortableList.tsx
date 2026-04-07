import React from "react";
import ReorderableList, {
  ReorderableListReorderEvent,
  useReorderableDrag,
  useIsActive,
  reorderItems,
} from "react-native-reorderable-list";

type DraggableWrapperProps = {
  children: (drag: () => void, isActive: boolean) => React.ReactNode;
};

function DraggableWrapper({ children }: DraggableWrapperProps) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  return <>{children(drag, isActive)}</>;
}

type Props<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, drag: () => void, isActive: boolean) => React.ReactNode;
  onReorder: (items: T[]) => void;
};

export function SortableList<T>({ items, keyExtractor, renderItem, onReorder }: Props<T>) {
  const handleReorder = ({ from, to }: ReorderableListReorderEvent) => {
    onReorder(reorderItems(items, from, to));
  };

  return (
    <ReorderableList
      data={items}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => (
        <DraggableWrapper>
          {(drag, isActive) => renderItem(item, drag, isActive)}
        </DraggableWrapper>
      )}
      onReorder={handleReorder}
    />
  );
}

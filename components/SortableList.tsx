import DraggableFlatList, {
  ScaleDecorator,
  RenderItemParams,
} from "react-native-draggable-flatlist";

type Props<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, drag: () => void, isActive: boolean) => React.ReactNode;
  onReorder: (items: T[]) => void;
};

export function SortableList<T>({ items, keyExtractor, renderItem, onReorder }: Props<T>) {
  return (
    <DraggableFlatList
      data={items}
      keyExtractor={keyExtractor}
      renderItem={({ item, drag, isActive }: RenderItemParams<T>) => (
        <ScaleDecorator>{renderItem(item, drag, isActive)}</ScaleDecorator>
      )}
      onDragEnd={({ data }) => onReorder(data)}
      containerStyle={{ flex: 1 }}
    />
  );
}

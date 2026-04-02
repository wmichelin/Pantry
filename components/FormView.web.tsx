import { StyleProp, ViewStyle } from "react-native";

type Props = {
  style?: StyleProp<ViewStyle>;
  onSubmit?: () => void;
  children: React.ReactNode;
};

export function FormView({ style, onSubmit, children }: Props) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
      style={{ display: "flex", flexDirection: "column", width: "100%", ...(style as React.CSSProperties) }}
    >
      {children}
    </form>
  );
}

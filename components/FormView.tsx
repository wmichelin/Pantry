import { View, StyleProp, ViewStyle } from "react-native";

type Props = {
  style?: StyleProp<ViewStyle>;
  onSubmit?: () => void;
  children: React.ReactNode;
};

export function FormView({ style, children }: Props) {
  return <View style={style}>{children}</View>;
}

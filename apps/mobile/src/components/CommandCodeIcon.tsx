import { Path, Svg } from "react-native-svg";

export function CommandCodeIcon(props: { readonly size: number; readonly color: string }) {
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m5 6 6 6-6 6M13 18h6"
        stroke={props.color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

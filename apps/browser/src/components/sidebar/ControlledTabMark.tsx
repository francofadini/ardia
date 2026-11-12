import { View } from "react-native";
import { useTabController } from "../../state/app/cliControl";
import { space } from "../ui";
import { ControllerMark } from "../window/ControllerMark";

const ROW_MARK = 12;
const TILE_MARK = 10;
const MARK_BOX = 16;

export function ControlledTabMark({ tabId, variant = "row" }: { tabId: string; variant?: "row" | "chip" | "tile" }) {
  const controller = useTabController(tabId);
  if (!controller) return null;
  const tooltip = `${controller} is controlling this tab`;
  if (variant === "tile") {
    return (
      <View pointerEvents="none" accessibilityLabel={tooltip} style={{ position: "absolute", bottom: 3, left: 4 }}>
        <ControllerMark controller={controller} size={TILE_MARK} />
      </View>
    );
  }
  return (
    <View
      tooltip={tooltip}
      accessibilityLabel={tooltip}
      style={{ width: MARK_BOX, height: MARK_BOX, alignItems: "center", justifyContent: "center", marginLeft: variant === "row" ? space.xs : 0 }}
    >
      <ControllerMark controller={controller} size={ROW_MARK} />
    </View>
  );
}

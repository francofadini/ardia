import { View } from "react-native";
import { useTabController } from "../../state/app/cliControl";
import { space } from "../ui";
import { ControllerMark } from "../window/ControllerMark";

const ROW_MARK = 12;
const TILE_MARK = 10;

export function ControlledTabMark({ tabId, tile = false }: { tabId: string; tile?: boolean }) {
  const controller = useTabController(tabId);
  if (!controller) return null;
  const tooltip = `${controller} is controlling this tab`;
  if (tile) {
    return (
      <View pointerEvents="none" accessibilityLabel={tooltip} style={{ position: "absolute", bottom: 3, left: 4 }}>
        <ControllerMark controller={controller} size={TILE_MARK} />
      </View>
    );
  }
  return (
    <View tooltip={tooltip} accessibilityLabel={tooltip} style={{ width: 18, height: 16, alignItems: "center", justifyContent: "center", marginLeft: space.s }}>
      <ControllerMark controller={controller} size={ROW_MARK} />
    </View>
  );
}

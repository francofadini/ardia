import { Animated, StyleSheet, View, type ViewStyle } from "react-native";
import { stopCliControl, useCliIndicator } from "../../state/app/cliControl";
import { DEFAULT_CONTROLLER } from "../../state/app/cliControlled";
import { useIsFocusedWindow } from "../../state/windows/hooks";
import { Button, space, Text, usePresence } from "../ui";
import { ControllerMark } from "./ControllerMark";
import { Hud } from "./Hud";
import { CLI_PILL_MOTION } from "./tokens";

const PILL_HEIGHT = 32;
const PILL_BOTTOM = 12;

type Shown = { controller: string; tab: boolean };

export function CliControlPill({ tabId, windowId, windowPill, style }: { tabId: string; windowId: string; windowPill: boolean; style?: Animated.WithAnimatedValue<ViewStyle> }) {
  const controller = useCliIndicator((s) => s.tabs[tabId] ?? null);
  const app = useCliIndicator((s) => s.shown);
  const focused = useIsFocusedWindow(windowId);
  const key = controller !== null ? `tab:${controller}` : app && windowPill && focused ? "app" : null;
  const { shown: mountedKey, appear } = usePresence(key, CLI_PILL_MOTION);
  if (!mountedKey) return null;
  const shown: Shown = mountedKey === "app" ? { controller: DEFAULT_CONTROLLER, tab: false } : { controller: mountedKey.slice(4), tab: true };
  const what = shown.tab ? "this tab" : "Ardia";
  return (
    <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style]}>
      <View pointerEvents="box-none" style={{ position: "absolute", left: space.l, right: space.l, bottom: PILL_BOTTOM, alignItems: "center" }}>
        <Animated.View
          pointerEvents={key ? "auto" : "none"}
          style={{
            maxWidth: "100%",
            opacity: appear,
            transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
          }}
        >
          <Hud shape="capsule" height={PILL_HEIGHT} accessibilityRole="alert" accessibilityLabel={`${shown.controller} is controlling ${what}`}>
            <View style={PILL_ROW}>
              <ControllerMark controller={shown.controller} size={MARK_SIZE} />
              <Text numberOfLines={1} size="small" tone="textSecondary" style={SHRINK}>
                <Text size="small" weight="semibold">
                  {shown.controller}
                </Text>
                {` is controlling ${what}`}
              </Text>
              <Button variant="pill" tone="chip" title="Stop" onPress={stopCliControl} />
            </View>
          </Hud>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const MARK_SIZE = 20;
const SHRINK = { flexShrink: 1 } as const;
const PILL_ROW = { height: PILL_HEIGHT, flexDirection: "row", alignItems: "center", gap: space.m, paddingLeft: space.s, paddingRight: space.xs } as const;

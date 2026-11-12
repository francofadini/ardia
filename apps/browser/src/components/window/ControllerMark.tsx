import { View } from "react-native";
import { useTheme } from "../ui/theme";
import { Dot, Symbol } from "../ui";
import { CLAUDE_MARK } from "./tokens";

export const isClaude = (controller: string) => /^claude\b/i.test(controller);

export function ControllerMark({ controller, size }: { controller: string; size: number }) {
  return isClaude(controller) ? <ClaudeMark size={size} /> : <TerminalMark size={size} />;
}

function TerminalMark({ size }: { size: number }) {
  const theme = useTheme();
  const glyph = Math.round(size * 0.7);
  return (
    <Dot size={size} color={theme.textPrimary}>
      <Symbol name="terminal.fill" size={Math.round(size * 0.45)} weight="bold" color={theme.onPrimary} style={{ width: glyph, height: glyph }} />
    </Dot>
  );
}

function ClaudeMark({ size }: { size: number }) {
  const half = size / 2;
  const width = Math.max(1.5, size * CLAUDE_MARK.rayWidth);
  const step = 360 / CLAUDE_MARK.rays.length;
  return (
    <View accessibilityLabel="Claude" style={{ width: size, height: size }}>
      {CLAUDE_MARK.rays.map((reach, i) => {
        const length = half * reach;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: half - width / 2,
              top: half - length,
              width,
              height: length,
              borderRadius: width / 2,
              backgroundColor: CLAUDE_MARK.color,
              transform: [{ translateY: length / 2 }, { rotate: `${i * step}deg` }, { translateY: -length / 2 }],
            }}
          />
        );
      })}
    </View>
  );
}

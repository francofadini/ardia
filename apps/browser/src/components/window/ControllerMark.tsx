import { Image } from "react-native";
import { useTheme } from "../ui/theme";
import { Dot, Symbol } from "../ui";

const CLAUDE_LOGO = {
  10: require("../../../assets/claude-mark-10.png"),
  12: require("../../../assets/claude-mark-12.png"),
  16: require("../../../assets/claude-mark-16.png"),
} as const;

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
  const drawn = size <= 10 ? 10 : size <= 12 ? 12 : 16;
  return <Image source={CLAUDE_LOGO[drawn]} accessibilityLabel="Claude" style={{ width: drawn, height: drawn }} />;
}

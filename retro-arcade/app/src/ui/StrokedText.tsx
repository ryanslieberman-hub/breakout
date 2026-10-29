import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { fonts, theme } from './theme';

interface Props {
  children: React.ReactNode;
  size?: number;
  color?: string;
  stroke?: string;
  width?: number;
  font?: string;
  /** Hard offset shadow under the lettering, the way 2013 game logos did it. */
  drop?: number;
  style?: TextStyle;
}

const DIRS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7],
];

/** React Native has no text stroke, so the outline is eight offset copies under the fill. */
export default function StrokedText({
  children, size = 32, color = theme.white, stroke = theme.ink, width = 3, font = fonts.display, drop = 0, style,
}: Props) {
  const base: TextStyle = { fontFamily: font, fontSize: size, lineHeight: size * 1.1, textAlign: 'center', ...style };
  const copies = DIRS.map(([dx, dy], i) => (
    <Text key={i} aria-hidden style={[base, styles.abs, { color: stroke, left: dx * width, top: dy * width }]}>{children}</Text>
  ));
  return (
    <View style={{ alignSelf: 'center' }}>
      {drop > 0 && (
        <Text aria-hidden style={[base, styles.abs, { color: stroke, left: 0, top: drop + width }]}>{children}</Text>
      )}
      {copies}
      <Text style={[base, { color }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', width: '100%' },
});

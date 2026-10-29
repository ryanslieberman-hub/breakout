import { Pressable, StyleSheet, View } from 'react-native';
import StrokedText from './StrokedText';
import { theme } from './theme';

interface Props {
  label: string;
  onPress: () => void;
  face?: string;
  lip?: string;
  size?: number;
  minWidth?: number;
}

/** Chunky button with a hard bottom lip that squashes on press. */
export default function Button3D({ label, onPress, face = theme.orange, lip = theme.orangeDark, size = 24, minWidth = 150 }: Props) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <View style={[styles.outer, { minWidth, backgroundColor: theme.ink, paddingBottom: pressed ? 2 : 6, marginTop: pressed ? 4 : 0 }]}>
          <View style={[styles.lip, { backgroundColor: lip, paddingBottom: pressed ? 0 : 0 }]}>
            <View style={[styles.face, { backgroundColor: face }]}>
              <View style={styles.shine} />
              <StrokedText size={size} width={2} style={{ paddingHorizontal: 22, paddingVertical: 7 }}>{label}</StrokedText>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { borderRadius: 14, padding: 3, alignItems: 'stretch' },
  lip: { borderRadius: 11, paddingBottom: 4 },
  face: { borderRadius: 10, overflow: 'hidden', alignItems: 'center' },
  shine: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: 'rgba(255,255,255,0.28)' },
});

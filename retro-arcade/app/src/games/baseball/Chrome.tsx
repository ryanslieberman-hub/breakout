import { Pressable, StyleSheet, Text, View } from 'react-native';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import { GOLD, NAVY } from './Card';

export function Coins({ n }: { n: number }) {
  return (
    <View style={styles.coins}>
      <View style={styles.coinDot}><View style={styles.coinInner} /></View>
      <StrokedText size={20} width={2}>{n}</StrokedText>
    </View>
  );
}

export function BackButton({ onPress, label = 'Back' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable style={styles.exit} onPress={onPress} hitSlop={12} accessibilityLabel={label}>
      <Text style={styles.exitText}>‹</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: GOLD, zIndex: 3 },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  coins: { position: 'absolute', top: 46, right: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: NAVY, paddingLeft: 6, paddingRight: 12, paddingVertical: 3, borderRadius: 18, borderWidth: 2.5, borderColor: GOLD, zIndex: 3 },
  coinDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD, borderWidth: 2.5, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  coinInner: { width: 9, height: 12, borderRadius: 3, backgroundColor: '#d99a00' },
});

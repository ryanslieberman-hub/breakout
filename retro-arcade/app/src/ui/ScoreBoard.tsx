import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import Button3D from './Button3D';
import StrokedText from './StrokedText';
import { fonts, theme } from './theme';

interface Props {
  score: number;
  best: number;
  isNew: boolean;
  /** Score needed for bronze, silver, gold. */
  medals?: [number, number, number];
  onPlay: () => void;
  onMenu: () => void;
}

const MEDALS = [
  { face: '#d98a4a', rim: '#8e4c1c' },
  { face: '#d8dde2', rim: '#8b949c' },
  { face: '#f7c93b', rim: '#c98a0c' },
];

/** Shared game-over panel: title, medal + score card that springs up, Play / Menu. */
export default function ScoreBoard({ score, best, isNew, medals = [5, 15, 30], onPlay, onMenu }: Props) {
  const cardIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(cardIn, { toValue: 1, friction: 7, tension: 70, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [cardIn]);

  const tier = medals.reduce((t, need, i) => (score >= need ? i : t), -1);
  const medal = tier >= 0 ? MEDALS[tier] : null;

  return (
    <View style={styles.wrap}>
      <StrokedText size={50} color={theme.orange} width={3} drop={3}>Game Over</StrokedText>
      <Animated.View
        style={[styles.board, { opacity: cardIn, transform: [{ translateY: cardIn.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] }]}
      >
        <View style={styles.inner}>
          <View style={styles.medalCol}>
            <Text style={styles.label}>MEDAL</Text>
            <View style={styles.medalSlot}>
              {medal ? (
                <View style={[styles.medal, { backgroundColor: medal.face, borderColor: medal.rim }]}>
                  <View style={styles.medalShine} />
                  <View style={[styles.medalCore, { borderColor: medal.rim }]} />
                </View>
              ) : (
                <View style={styles.medalEmpty} />
              )}
            </View>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.label}>SCORE</Text>
            <StrokedText size={32} width={2}>{score}</StrokedText>
            <Text style={[styles.label, { marginTop: 6 }]}>BEST</Text>
            <StrokedText size={32} width={2}>{best}</StrokedText>
            {isNew && (
              <View style={styles.newTag}>
                <Text style={styles.newText}>NEW</Text>
              </View>
            )}
          </View>
        </View>
      </Animated.View>
      <View style={styles.btnRow}>
        <Button3D label="Play" onPress={onPlay} minWidth={130} />
        <Button3D label="Menu" onPress={onMenu} face="#5aa9e8" lip="#2c6fae" minWidth={130} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: 'rgba(59,42,63,0.28)' },
  board: { width: 270, backgroundColor: theme.ink, borderRadius: 12, padding: 3 },
  inner: { flexDirection: 'row', backgroundColor: theme.panel, borderRadius: 9, borderWidth: 3, borderColor: theme.sandDark, padding: 14, gap: 12 },
  label: { fontFamily: fonts.pixelBold, fontSize: 11, color: '#e0701c', letterSpacing: 1 },
  medalCol: { flex: 1, gap: 8 },
  medalSlot: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#cfc788', borderWidth: 3, borderColor: theme.sandDark, alignItems: 'center', justifyContent: 'center' },
  medal: { width: 62, height: 62, borderRadius: 31, borderWidth: 4, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  medalShine: { position: 'absolute', top: 0, left: 0, right: 0, height: 24, backgroundColor: 'rgba(255,255,255,0.4)' },
  medalCore: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  medalEmpty: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: theme.sandDark, borderStyle: 'dashed' },
  statCol: { flex: 1, alignItems: 'flex-end' },
  newTag: { position: 'absolute', right: -4, bottom: -2, backgroundColor: theme.red, borderWidth: 2, borderColor: theme.ink, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, transform: [{ rotate: '-6deg' }] },
  newText: { fontFamily: fonts.pixelBold, fontSize: 11, color: '#fff' },
  btnRow: { flexDirection: 'row', gap: 12 },
});

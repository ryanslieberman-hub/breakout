import { useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Button3D from '../../ui/Button3D';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import PlayerCard, { CardBack } from './Card';
import { RARITY, drawPlayer, playerById } from './league';
import { PACK_COST, openPack, useSave } from './store';

interface Slot { id: number; dupe: boolean; revealed: boolean; flip: Animated.Value }

const useNative = Platform.OS !== 'web';

export default function Packs({ onBack }: { onBack: () => void }) {
  const { width: W } = useWindowDimensions();
  const save = useSave();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const cardW = Math.min(112, (W - 56) / 3);
  const flipping = useRef(new Set<number>());

  const open = () => {
    if (save.coins < PACK_COST) return;
    const ids: number[] = [];
    while (ids.length < 5) ids.push(drawPlayer().id);
    const { dupes } = openPack(ids);
    flipping.current.clear();
    setSlots(ids.map((id, i) => ({ id, dupe: dupes[i], revealed: false, flip: new Animated.Value(1) })));
  };

  const reveal = (i: number) => {
    if (!slots || slots[i].revealed || flipping.current.has(i)) return;
    flipping.current.add(i);
    const s = slots[i];
    Animated.timing(s.flip, { toValue: 0, duration: 110, useNativeDriver: useNative }).start(() => {
      setSlots((cur) => cur && cur.map((x, k) => (k === i ? { ...x, revealed: true } : x)));
      Animated.spring(s.flip, { toValue: 1, friction: 6, tension: 160, useNativeDriver: useNative }).start(() => { flipping.current.delete(i); });
    });
  };

  const revealAll = () => { slots?.forEach((_, i) => setTimeout(() => reveal(i), i * 260)); };
  const allRevealed = !!slots && slots.every((s) => s.revealed);
  const best = slots ? Math.max(...slots.map((s) => playerById(s.id).ovr)) : 0;

  return (
    <View style={styles.root}>
      <Pressable style={styles.exit} onPress={onBack} hitSlop={12} accessibilityLabel="Back">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>
      <View style={styles.coins}><View style={styles.coinDot} /><StrokedText size={20} width={2}>{save.coins}</StrokedText></View>

      {!slots && (
        <View style={styles.center}>
          <StrokedText size={40} color={theme.yellow} width={3} drop={3}>Card Pack</StrokedText>
          <View style={styles.pack}>
            <View style={styles.packShine} />
            <View style={styles.packBall}>
              <View style={[styles.stitch, { left: -14 }]} /><View style={[styles.stitch, { right: -14 }]} />
            </View>
            <StrokedText size={22} width={2.5}>5 PLAYERS</StrokedText>
          </View>
          <Text style={styles.odds}>
            {(['common', 'uncommon', 'rare', 'epic', 'legend'] as const).map((r) => RARITY[r].label).join(' · ')}
          </Text>
          <Button3D label={`Open · ${PACK_COST}`} onPress={open} face={save.coins >= PACK_COST ? theme.orange : '#9a9fb0'} lip={save.coins >= PACK_COST ? theme.orangeDark : '#6b6f80'} minWidth={190} />
          {save.coins < PACK_COST && <Text style={styles.note}>Win games to earn more coins.</Text>}
        </View>
      )}

      {slots && (
        <View style={styles.center}>
          <StrokedText size={32} color={theme.yellow} width={3} drop={3}>{allRevealed ? (best >= 83 ? 'Big pull!' : 'Your cards') : 'Tap to flip'}</StrokedText>
          <View style={styles.grid}>
            {slots.map((s, i) => (
              <Pressable key={i} onPress={() => reveal(i)} accessibilityLabel={s.revealed ? `${playerById(s.id).last}` : 'Hidden card'}>
                <Animated.View style={{ transform: [{ scaleX: s.flip }] }}>
                  {s.revealed ? <PlayerCard p={playerById(s.id)} width={cardW} /> : <CardBack width={cardW} />}
                </Animated.View>
                {s.revealed && (
                  <View style={[styles.tag, { backgroundColor: s.dupe ? '#5aa9e8' : theme.red }]}>
                    <Text style={styles.tagText}>{s.dupe ? 'DUPE +25' : 'NEW'}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {!allRevealed && <Button3D label="Flip all" onPress={revealAll} face="#5aa9e8" lip="#2c6fae" minWidth={130} />}
            {allRevealed && <Button3D label="Another" onPress={() => setSlots(null)} minWidth={130} />}
            {allRevealed && <Button3D label="Done" onPress={onBack} face="#5aa9e8" lip="#2c6fae" minWidth={130} />}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1d3b2c' },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', zIndex: 3 },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  coins: { position: 'absolute', top: 48, right: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,42,63,0.8)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, zIndex: 3 },
  coinDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: theme.yellow, borderWidth: 2.5, borderColor: theme.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingTop: 30 },
  pack: { width: 170, height: 230, borderRadius: 16, backgroundColor: theme.red, borderWidth: 4, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center', gap: 16, overflow: 'hidden', boxShadow: '0px 8px 0px #7d2a1a' },
  packShine: { position: 'absolute', left: -20, top: 0, width: 60, height: 300, backgroundColor: 'rgba(255,255,255,0.18)', transform: [{ rotate: '18deg' }] },
  packBall: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#fff', borderWidth: 4, borderColor: theme.ink, overflow: 'hidden' },
  stitch: { position: 'absolute', top: 10, width: 44, height: 60, borderRadius: 30, borderWidth: 2.5, borderColor: theme.red },
  odds: { fontFamily: fonts.pixel, fontSize: 9, color: '#cfe4fa', opacity: 0.8, textAlign: 'center', paddingHorizontal: 20 },
  note: { fontFamily: fonts.pixelBold, fontSize: 10, color: '#ffb74d' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, paddingHorizontal: 14 },
  tag: { position: 'absolute', top: -6, right: -6, borderWidth: 2, borderColor: theme.ink, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, transform: [{ rotate: '6deg' }] },
  tagText: { fontFamily: fonts.pixelBold, fontSize: 9, color: '#fff' },
});

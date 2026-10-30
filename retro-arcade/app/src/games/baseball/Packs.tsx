import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Button3D from '../../ui/Button3D';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import PlayerCard, { CardBack, GOLD, NAVY } from './Card';
import { BackButton, Coins } from './Chrome';
import Stadium from './Stadium';
import { drawPlayer, playerById } from './league';
import { PACK_COST, openPack, useSave } from './store';

interface Slot { id: number; dupe: boolean; revealed: boolean; flip: Animated.Value }

const useNative = Platform.OS !== 'web';

function PackArt() {
  const crimp = (top: boolean) => (
    <View style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: 16, flexDirection: 'row', overflow: 'hidden', backgroundColor: '#b8860b' }}>
      {Array.from({ length: 22 }, (_, i) => <View key={i} style={{ width: 8, height: 16, backgroundColor: i % 2 ? '#f5c542' : '#8a6408', transform: [{ skewX: '-30deg' }] }} />)}
    </View>
  );
  return (
    <View style={styles.pack}>
      <LinearGradient colors={['#1b2a5c', NAVY]} style={StyleSheet.absoluteFill} />
      {[-30, 40, 110].map((x) => <View key={x} style={{ position: 'absolute', left: x, top: -20, width: 26, height: 300, backgroundColor: 'rgba(245,197,66,0.1)', transform: [{ rotate: '22deg' }] }} />)}
      {crimp(true)}
      {crimp(false)}
      <View style={styles.packBall}>
        <View style={[styles.stitch, { left: -22 }]} /><View style={[styles.stitch, { right: -22 }]} />
      </View>
      <StrokedText size={24} color={GOLD} width={2.5} drop={2}>ELITE PACK</StrokedText>
      <Text style={styles.packSub}>5 PLAYERS INSIDE</Text>
      <View style={{ position: 'absolute', left: 60, top: -10, width: 22, height: 300, backgroundColor: 'rgba(255,255,255,0.14)', transform: [{ rotate: '22deg' }] }} />
    </View>
  );
}

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
  const canOpen = save.coins >= PACK_COST;

  return (
    <View style={styles.root}>
      <Stadium horizon={0.3} />
      <LinearGradient colors={['rgba(5,10,30,0)', 'rgba(5,10,30,0.9)']} style={{ position: 'absolute', left: 0, right: 0, top: '25%', bottom: 0 }} />
      <BackButton onPress={onBack} />
      <Coins n={save.coins} />

      {!slots && (
        <View style={styles.center}>
          <StrokedText size={38} width={3} drop={3}>Card Packs</StrokedText>
          <View style={{ transform: [{ rotate: '-4deg' }] }}><PackArt /></View>
          <Button3D label={`Open · ${PACK_COST}`} onPress={open} face={canOpen ? GOLD : '#7d849c'} lip={canOpen ? '#b8860b' : '#4a5068'} minWidth={200} />
          {!canOpen && <Text style={styles.note}>WIN GAMES TO EARN MORE COINS</Text>}
        </View>
      )}

      {slots && (
        <View style={styles.center}>
          <StrokedText size={32} color={GOLD} width={3} drop={3}>{allRevealed ? (best >= 83 ? 'Big pull!' : 'Your cards') : 'Tap to flip'}</StrokedText>
          <View style={styles.grid}>
            {slots.map((s, i) => (
              <Pressable key={i} onPress={() => reveal(i)} accessibilityLabel={s.revealed ? `${playerById(s.id).last}` : 'Hidden card'}>
                <Animated.View style={{ transform: [{ scaleX: s.flip }] }}>
                  {s.revealed ? <PlayerCard p={playerById(s.id)} width={cardW} /> : <CardBack width={cardW} />}
                </Animated.View>
                {s.revealed && (
                  <View style={[styles.tag, { backgroundColor: s.dupe ? '#3f6fd0' : theme.red }]}>
                    <Text style={styles.tagText}>{s.dupe ? 'DUPE +25' : 'NEW'}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {!allRevealed && <Button3D label="Flip all" onPress={revealAll} face="#3f6fd0" lip="#1d3f8f" minWidth={140} />}
            {allRevealed && <Button3D label="Another" onPress={() => setSlots(null)} face={GOLD} lip="#b8860b" textColor={NAVY} stroke="#fff3b0" strokeWidth={1.5} minWidth={130} />}
            {allRevealed && <Button3D label="Done" onPress={onBack} face="#3f6fd0" lip="#1d3f8f" minWidth={130} />}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingTop: 30 },
  pack: { width: 176, height: 250, borderRadius: 10, borderWidth: 4, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center', gap: 12, overflow: 'hidden', boxShadow: '0px 10px 0px rgba(0,0,0,0.45)' },
  packBall: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#fff', borderWidth: 5, borderColor: GOLD, overflow: 'hidden' },
  stitch: { position: 'absolute', top: 8, width: 46, height: 58, borderRadius: 30, borderWidth: 2.5, borderColor: theme.red },
  packSub: { fontFamily: fonts.pixelBold, fontSize: 7, color: '#aab6df', letterSpacing: 0.5, textAlign: 'center' },
  note: { fontFamily: fonts.pixelBold, fontSize: 10, color: GOLD, letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, paddingHorizontal: 14 },
  tag: { position: 'absolute', top: -6, right: -6, borderWidth: 2, borderColor: theme.ink, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, transform: [{ rotate: '6deg' }] },
  tagText: { fontFamily: fonts.pixelBold, fontSize: 9, color: '#fff' },
});

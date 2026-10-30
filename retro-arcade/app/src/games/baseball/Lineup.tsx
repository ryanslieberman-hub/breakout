import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import Bust from './Bust';
import PlayerCard, { GOLD, NAVY } from './Card';
import { BackButton } from './Chrome';
import { RARITY, playerById } from './league';
import { teamOvr, update, useSave } from './store';

export default function Lineup({ onBack }: { onBack: () => void }) {
  const { width: W } = useWindowDimensions();
  const save = useSave();
  const [slot, setSlot] = useState(0);
  const cardW = Math.floor((W - 24 - 10 * 3) / 3);

  const assign = (id: number) => {
    update((s) => {
      const lineup = [...s.lineup];
      const at = lineup.indexOf(id);
      if (at === slot) return s;
      if (at >= 0) lineup[at] = lineup[slot];
      lineup[slot] = id;
      return { ...s, lineup };
    });
  };

  const owned = [...save.owned].sort((a, b) => playerById(b).ovr - playerById(a).ovr);
  const ovr = teamOvr(save.lineup.map((id) => playerById(id).ovr));

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#050a1e', '#10204f']} style={StyleSheet.absoluteFill} />
      <BackButton onPress={onBack} />
      <View style={styles.head}>
        <StrokedText size={34} color={GOLD} width={3} drop={2}>Lineup</StrokedText>
        <View style={styles.ovrChip}>
          <Text style={styles.ovrLabel}>TEAM OVR</Text>
          <StrokedText size={22} width={2}>{ovr}</StrokedText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.section}>BATTING ORDER · TAP A SPOT, THEN A CARD</Text>
        <View style={styles.slots}>
          {save.lineup.map((id, i) => {
            const p = playerById(id);
            const on = i === slot;
            return (
              <Pressable key={i} onPress={() => setSlot(i)} style={[styles.slot, on && styles.slotOn]} accessibilityLabel={`Spot ${i + 1}, ${p.last}`}>
                <View style={[styles.num, on && { backgroundColor: GOLD }]}><Text style={[styles.numText, on && { color: NAVY }]}>{i + 1}</Text></View>
                <View style={[styles.face, { borderColor: RARITY[p.rarity].frame, backgroundColor: p.team.color }]}>
                  <View style={{ position: 'absolute', left: -3, top: 2 }}><Bust p={p} w={42} /></View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.slotName}>{p.first[0]}. {p.last}</Text>
                  <Text style={styles.slotSub}>{p.pos} · {p.team.name.toUpperCase()}</Text>
                </View>
                <Text style={styles.slotOvr}>{p.ovr}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section}>YOUR CARDS · {owned.length} OF 120</Text>
        <View style={styles.grid}>
          {owned.map((id) => (
            <Pressable key={id} onPress={() => assign(id)} accessibilityLabel={`Put ${playerById(id).last} in spot ${slot + 1}`}>
              <PlayerCard p={playerById(id)} width={cardW} dim={save.lineup.includes(id) && save.lineup[slot] !== id} />
              {save.lineup.includes(id) && (
                <View style={styles.inTag}><Text style={styles.inTagText}>{save.lineup.indexOf(id) + 1}</Text></View>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY, paddingTop: 44 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 70, paddingRight: 14, height: 44, marginBottom: 12 },
  ovrChip: { backgroundColor: NAVY, borderRadius: 12, borderWidth: 2.5, borderColor: GOLD, paddingHorizontal: 12, paddingVertical: 1, alignItems: 'center' },
  ovrLabel: { fontFamily: fonts.pixelBold, fontSize: 8, color: GOLD, letterSpacing: 1 },
  section: { fontFamily: fonts.pixelBold, fontSize: 9, color: '#8f9bc0', letterSpacing: 1, marginHorizontal: 14, marginTop: 8, marginBottom: 8 },
  slots: { marginHorizontal: 12, gap: 5 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: 'rgba(27,42,92,0.8)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 2, borderColor: 'transparent' },
  slotOn: { borderColor: GOLD, backgroundColor: 'rgba(245,197,66,0.14)' },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#2a3b78', alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: fonts.pixelBold, fontSize: 10, color: '#fff' },
  face: { width: 38, height: 38, borderRadius: 19, borderWidth: 2.5, overflow: 'hidden' },
  slotName: { fontFamily: fonts.display, fontSize: 17, color: '#fff' },
  slotSub: { fontFamily: fonts.pixel, fontSize: 8, color: '#8f9bc0' },
  slotOvr: { fontFamily: fonts.display, fontSize: 22, color: GOLD, width: 34, textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: 12 },
  inTag: { position: 'absolute', top: -5, left: -5, width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD, borderWidth: 2, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  inTagText: { fontFamily: fonts.pixelBold, fontSize: 10, color: NAVY },
});

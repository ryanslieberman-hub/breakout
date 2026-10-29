import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import PlayerCard from './Card';
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
      <Pressable style={styles.exit} onPress={onBack} hitSlop={12} accessibilityLabel="Back">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>
      <View style={styles.head}>
        <StrokedText size={34} color={theme.yellow} width={3} drop={2}>Lineup</StrokedText>
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
                <Text style={styles.slotNum}>{i + 1}</Text>
                <View style={[styles.dot, { backgroundColor: RARITY[p.rarity].frame }]} />
                <Text numberOfLines={1} style={styles.slotName}>{p.first[0]}. {p.last}</Text>
                <Text style={styles.slotPos}>{p.pos}</Text>
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
  root: { flex: 1, backgroundColor: '#1d3b2c', paddingTop: 44 },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', zIndex: 3 },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 70, paddingRight: 14, height: 44, marginBottom: 12 },
  ovrChip: { backgroundColor: theme.ink, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 2, alignItems: 'center' },
  ovrLabel: { fontFamily: fonts.pixelBold, fontSize: 8, color: '#ffb74d', letterSpacing: 1 },
  section: { fontFamily: fonts.pixelBold, fontSize: 9, color: '#9ec9ad', letterSpacing: 1, marginHorizontal: 14, marginTop: 8, marginBottom: 8 },
  slots: { marginHorizontal: 12, gap: 4 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: 'transparent' },
  slotOn: { borderColor: theme.yellow, backgroundColor: 'rgba(255,210,63,0.16)' },
  slotNum: { width: 16, fontFamily: fonts.pixelBold, fontSize: 11, color: '#9ec9ad' },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: theme.ink },
  slotName: { flex: 1, fontFamily: fonts.display, fontSize: 16, color: '#fff' },
  slotPos: { fontFamily: fonts.pixelBold, fontSize: 10, color: '#9ec9ad', width: 26 },
  slotOvr: { fontFamily: fonts.display, fontSize: 18, color: theme.yellow, width: 28, textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: 12 },
  inTag: { position: 'absolute', top: -5, left: -5, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.yellow, borderWidth: 2, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  inTagText: { fontFamily: fonts.pixelBold, fontSize: 10, color: theme.ink },
});

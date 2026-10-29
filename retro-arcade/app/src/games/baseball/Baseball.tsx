import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { submitScore } from '../../core/scores';
import type { GameProps } from '../../core/types';
import Button3D from '../../ui/Button3D';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import PlayerCard from './Card';
import Lineup from './Lineup';
import Match, { type MatchResult } from './Match';
import Packs from './Packs';
import { TEAMS, playerById } from './league';
import { PACK_COST, teamOvr, update, useSave } from './store';

type Screen = 'menu' | 'match' | 'packs' | 'lineup' | 'summary';

export default function Baseball({ onExit }: GameProps) {
  const { width: W } = useWindowDimensions();
  const save = useSave();
  const [screen, setScreen] = useState<Screen>('menu');
  const [opp, setOpp] = useState({ team: TEAMS[1], ovr: 60 });
  const [summary, setSummary] = useState<(MatchResult & { coins: number }) | null>(null);
  const [matchKey, setMatchKey] = useState(0);

  const lineup = save.lineup.map(playerById);
  const ovr = teamOvr(lineup.map((p) => p.ovr));
  const fan = [...lineup].sort((a, b) => b.ovr - a.ovr).slice(0, 3);
  const cardW = Math.min(104, W * 0.27);

  const play = () => {
    const pool = TEAMS.filter((t) => t.id !== lineup[0].team.id);
    setOpp({ team: pool[Math.floor(Math.random() * pool.length)], ovr: ovr + Math.round(Math.random() * 12 - 5) });
    setMatchKey((k) => k + 1);
    setScreen('match');
  };

  const finish = (r: MatchResult) => {
    const coins = (r.won ? 150 : 40) + r.runsFor * 10;
    update((s) => ({ ...s, coins: s.coins + coins, wins: s.wins + (r.won ? 1 : 0), losses: s.losses + (r.won ? 0 : 1) }));
    if (r.won) submitScore('baseball', save.wins + 1);
    setSummary({ ...r, coins });
    setScreen('summary');
  };

  if (screen === 'match') return <Match key={matchKey} lineup={lineup} oppTeam={opp.team} oppOvr={opp.ovr} onFinish={finish} onExit={() => setScreen('menu')} />;
  if (screen === 'packs') return <Packs onBack={() => setScreen('menu')} />;
  if (screen === 'lineup') return <Lineup onBack={() => setScreen('menu')} />;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#173a2a', '#2f8a4a']} style={StyleSheet.absoluteFill} />
      <View style={styles.diamond} />

      <Pressable style={styles.exit} onPress={onExit} hitSlop={12} accessibilityLabel="Back to home screen">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>
      <View style={styles.coins}><View style={styles.coinDot} /><StrokedText size={20} width={2}>{save.coins}</StrokedText></View>

      {screen === 'summary' && summary ? (
        <View style={styles.center}>
          <StrokedText size={50} color={summary.won ? theme.yellow : '#ff8a8a'} width={3} drop={3}>{summary.won ? 'Victory!' : 'Tough loss'}</StrokedText>
          <StrokedText size={34} width={3}>{`${summary.runsFor} - ${summary.runsAgainst}`}</StrokedText>
          <View style={styles.reward}>
            <View style={styles.coinDot} />
            <StrokedText size={26} color={theme.yellow} width={2.5}>{`+${summary.coins}`}</StrokedText>
          </View>
          <Text style={styles.hint}>{summary.won ? '150 for the win' : '40 for playing'} + 10 per run</Text>
          <View style={{ gap: 12, marginTop: 8 }}>
            <Button3D label="Play again" onPress={play} minWidth={190} />
            <Button3D label="Menu" onPress={() => setScreen('menu')} face="#5aa9e8" lip="#2c6fae" minWidth={190} />
          </View>
        </View>
      ) : (
        <View style={styles.center}>
          <View style={{ transform: [{ rotate: '-3deg' }] }}>
            <StrokedText size={46} color={theme.yellow} width={3.5} drop={4}>Diamond</StrokedText>
            <StrokedText size={46} width={3.5} drop={4}>Duel</StrokedText>
          </View>

          <View style={styles.fan}>
            {fan.map((p, i) => (
              <View key={p.id} style={{ marginHorizontal: -8, transform: [{ rotate: `${(i - 1) * 7}deg` }, { translateY: i === 1 ? -10 : 4 }], zIndex: i === 1 ? 2 : 1 }}>
                <PlayerCard p={p} width={cardW} />
              </View>
            ))}
          </View>

          <View style={styles.stats}>
            <View style={styles.stat}><Text style={styles.statLabel}>TEAM OVR</Text><StrokedText size={22} width={2}>{ovr}</StrokedText></View>
            <View style={styles.stat}><Text style={styles.statLabel}>RECORD</Text><StrokedText size={22} width={2}>{`${save.wins}-${save.losses}`}</StrokedText></View>
          </View>

          <View style={{ gap: 12 }}>
            <Button3D label="Play ball" onPress={play} size={28} minWidth={230} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button3D label={`Packs · ${PACK_COST}`} onPress={() => setScreen('packs')} face="#e8402e" lip="#a8301f" minWidth={110} size={18} />
              <Button3D label="Lineup" onPress={() => setScreen('lineup')} face="#5aa9e8" lip="#2c6fae" minWidth={110} size={18} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#173a2a', overflow: 'hidden' },
  diamond: { position: 'absolute', left: '-20%', right: '-20%', bottom: -300, height: 560, backgroundColor: 'rgba(201,143,90,0.35)', transform: [{ rotate: '45deg' }], borderWidth: 4, borderColor: 'rgba(255,255,255,0.25)' },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', zIndex: 3 },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  coins: { position: 'absolute', top: 48, right: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,42,63,0.8)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, zIndex: 3 },
  coinDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: theme.yellow, borderWidth: 2.5, borderColor: theme.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, paddingTop: 40 },
  fan: { flexDirection: 'row', alignItems: 'flex-end', height: 190, marginTop: 6 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { backgroundColor: theme.ink, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 3, alignItems: 'center', minWidth: 96 },
  statLabel: { fontFamily: fonts.pixelBold, fontSize: 9, color: '#ffb74d', letterSpacing: 1 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hint: { fontFamily: fonts.pixel, fontSize: 10, color: '#cfe4fa' },
});

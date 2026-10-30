import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { submitScore } from '../../core/scores';
import type { GameProps } from '../../core/types';
import Button3D from '../../ui/Button3D';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import PlayerCard, { GOLD, NAVY } from './Card';
import { BackButton, Coins } from './Chrome';
import Lineup from './Lineup';
import Match, { type MatchResult } from './Match';
import Packs from './Packs';
import Stadium from './Stadium';
import { TEAMS, playerById } from './league';
import { PACK_COST, teamOvr, update, useSave } from './store';

type Screen = 'menu' | 'match' | 'packs' | 'lineup' | 'summary';

function Tile({ title, sub, onPress, art }: { title: string; sub: string; onPress: () => void; art: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}, ${sub}`} style={{ flex: 1 }}>
      {({ pressed }) => (
        <View style={[styles.tile, pressed && { transform: [{ translateY: 3 }] }]}>
          <View style={styles.tileArt}>{art}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tileTitle}>{title}</Text>
            <Text style={styles.tileSub}>{sub}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

export default function Baseball({ onExit }: GameProps) {
  const { width: W } = useWindowDimensions();
  const save = useSave();
  const [screen, setScreen] = useState<Screen>('menu');
  const [opp, setOpp] = useState({ team: TEAMS[1], ovr: 60 });
  const [summary, setSummary] = useState<(MatchResult & { coins: number }) | null>(null);
  const [matchKey, setMatchKey] = useState(0);

  const lineup = save.lineup.map(playerById);
  const ovr = teamOvr(lineup.map((p) => p.ovr));
  const best = [...lineup].sort((a, b) => b.ovr - a.ovr).slice(0, 3);
  const heroW = Math.min(148, W * 0.4);
  const sideW = heroW * 0.78;

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
      <Stadium horizon={0.5} />
      <LinearGradient colors={['rgba(5,10,30,0)', 'rgba(5,10,30,0.85)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' }} />

      <BackButton onPress={onExit} label="Back to home screen" />
      <Coins n={save.coins} />

      {screen === 'summary' && summary ? (
        <View style={styles.center}>
          <StrokedText size={52} color={summary.won ? GOLD : '#ff8a8a'} width={3.5} drop={4}>{summary.won ? 'Victory!' : 'Tough loss'}</StrokedText>
          <View style={styles.finalScore}>
            <Text style={styles.finalLabel}>FINAL</Text>
            <StrokedText size={44} width={3}>{`${summary.runsFor} – ${summary.runsAgainst}`}</StrokedText>
          </View>
          <View style={styles.reward}>
            <View style={styles.coinDot}><View style={styles.coinInner} /></View>
            <StrokedText size={30} color={GOLD} width={2.5}>{`+${summary.coins}`}</StrokedText>
          </View>
          <Text style={styles.hint}>{summary.won ? '150 FOR THE WIN' : '40 FOR PLAYING'} + 10 PER RUN</Text>
          <View style={{ gap: 12, marginTop: 10 }}>
            <Button3D label="Play again" onPress={play} face={GOLD} lip="#b8860b" textColor={NAVY} stroke="#fff3b0" strokeWidth={1.5} minWidth={210} />
            <Button3D label="Menu" onPress={() => setScreen('menu')} face="#3f6fd0" lip="#1d3f8f" minWidth={210} />
          </View>
        </View>
      ) : (
        <View style={styles.center}>
          <View style={styles.logo}>
            <View style={styles.logoBall}>
              <View style={[styles.stitch, { left: -9 }]} /><View style={[styles.stitch, { right: -9 }]} />
            </View>
            <View style={{ transform: [{ rotate: '-3deg' }] }}>
              <StrokedText size={44} color={GOLD} width={3.5} drop={4}>Diamond</StrokedText>
              <StrokedText size={44} width={3.5} drop={4}>Duel</StrokedText>
            </View>
          </View>

          <View style={{ height: heroW * 1.5 + 26, width: W, alignItems: 'center' }}>
            <View style={styles.spot} />
            <View style={{ position: 'absolute', top: 22, left: W / 2 - heroW / 2 - sideW * 0.74, transform: [{ rotate: '-9deg' }] }}>
              <PlayerCard p={best[1]} width={sideW} />
            </View>
            <View style={{ position: 'absolute', top: 22, left: W / 2 + heroW / 2 - sideW * 0.26, transform: [{ rotate: '9deg' }] }}>
              <PlayerCard p={best[2]} width={sideW} />
            </View>
            <View style={{ position: 'absolute', top: 0, left: W / 2 - heroW / 2 }}>
              <PlayerCard p={best[0]} width={heroW} />
            </View>
          </View>

          <View style={styles.stats}>
            <View style={styles.stat}><Text style={styles.statLabel}>TEAM OVR</Text><StrokedText size={24} width={2}>{ovr}</StrokedText></View>
            <View style={styles.stat}><Text style={styles.statLabel}>RECORD</Text><StrokedText size={24} width={2}>{`${save.wins}-${save.losses}`}</StrokedText></View>
          </View>

          <View style={{ gap: 12, width: '100%', paddingHorizontal: 20, alignItems: 'center' }}>
            <Button3D label="Play ball" onPress={play} size={30} minWidth={250} face={GOLD} lip="#b8860b" textColor={NAVY} stroke="#fff3b0" strokeWidth={1.5} />
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <Tile
                title="Card Packs"
                sub={`${PACK_COST} coins`}
                onPress={() => setScreen('packs')}
                art={<View style={styles.miniPack}><View style={styles.miniBall} /></View>}
              />
              <Tile
                title="Lineup"
                sub="Set your order"
                onPress={() => setScreen('lineup')}
                art={<View style={{ gap: 3 }}>{[0, 1, 2].map((i) => <View key={i} style={{ width: 26 - i * 3, height: 5, borderRadius: 2, backgroundColor: i ? '#8f9bc0' : GOLD }} />)}</View>}
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY, overflow: 'hidden' },
  coinDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD, borderWidth: 2.5, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  coinInner: { width: 9, height: 12, borderRadius: 3, backgroundColor: '#d99a00' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 34 },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBall: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#fff', borderWidth: 3.5, borderColor: theme.ink, overflow: 'hidden', boxShadow: '0px 3px 0px rgba(0,0,0,0.4)' },
  stitch: { position: 'absolute', top: 6, width: 26, height: 34, borderRadius: 18, borderWidth: 2, borderColor: theme.red },
  spot: { position: 'absolute', top: 6, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(245,197,66,0.13)' },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { backgroundColor: 'rgba(12,22,52,0.9)', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 3, alignItems: 'center', minWidth: 104, borderWidth: 2, borderColor: 'rgba(245,197,66,0.6)' },
  statLabel: { fontFamily: fonts.pixelBold, fontSize: 9, color: GOLD, letterSpacing: 1 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#14275c', borderRadius: 14, borderWidth: 2.5, borderColor: GOLD, paddingHorizontal: 10, paddingVertical: 9, boxShadow: '0px 4px 0px #070d24' },
  tileArt: { width: 40, height: 40, borderRadius: 10, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontFamily: fonts.display, fontSize: 17, color: '#fff' },
  tileSub: { fontFamily: fonts.pixel, fontSize: 9, color: '#8f9bc0', marginTop: 1 },
  miniPack: { width: 22, height: 30, borderRadius: 4, backgroundColor: theme.red, borderWidth: 2, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  miniBall: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#fff', borderWidth: 1.5, borderColor: theme.ink },
  finalScore: { alignItems: 'center', backgroundColor: 'rgba(12,22,52,0.9)', borderWidth: 2.5, borderColor: GOLD, borderRadius: 16, paddingHorizontal: 34, paddingVertical: 8 },
  finalLabel: { fontFamily: fonts.pixelBold, fontSize: 10, color: GOLD, letterSpacing: 2 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hint: { fontFamily: fonts.pixelBold, fontSize: 10, color: '#8f9bc0', letterSpacing: 1 },
});

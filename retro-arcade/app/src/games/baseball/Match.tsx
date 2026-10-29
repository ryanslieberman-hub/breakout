import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Platform as RNPlatform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { useGameLoop } from '../../core/useGameLoop';
import Button3D from '../../ui/Button3D';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import Runner from '../dash/Runner';
import { TEAMS, type Player, type Team } from './league';

const INNINGS = 3;
const ZONE_HALF = 34;
const WINDOW = 0.17; // seconds either side of the plate that still count as contact

type Phase = 'wait' | 'pitch' | 'flight' | 'result' | 'cpu' | 'final';
type PitchType = 'FASTBALL' | 'CURVEBALL' | 'CHANGEUP';
type Outcome = 'HR' | '3B' | '2B' | '1B' | 'OUT' | 'FOUL' | 'MISS' | 'BALL' | 'STRIKE';

interface Pitch { type: PitchType; dur: number; ex: number; side: number; t0: number }
interface Banner { text: string; color: string; sub?: string }

export interface MatchResult { won: boolean; runsFor: number; runsAgainst: number }

const H_TAG = 108;
const BAT_ANGLE = (t: number) => (t < 0 ? -55 : -55 + Math.min(1, t / 0.16) * 130);

export default function Match({ lineup, oppTeam, oppOvr, onFinish, onExit }: {
  lineup: Player[];
  oppTeam: Team;
  oppOvr: number;
  onFinish: (r: MatchResult) => void;
  onExit: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const cx = W / 2;
  const diagHalf = W * 0.4;
  const centerY = H * 0.47;
  const homeY = centerY + diagHalf;
  const secondY = centerY - diagHalf;
  const wallY = H * 0.2;
  const moundY = centerY + diagHalf * 0.12;
  const bases = [
    { x: cx + diagHalf, y: centerY },
    { x: cx, y: secondY },
    { x: cx - diagHalf, y: centerY },
  ];

  const [, render] = useReducer((n: number) => n + 1, 0);
  const phase = useRef<Phase>('wait');
  const time = useRef(0);
  const phaseT = useRef(0);
  const pitch = useRef<Pitch | null>(null);
  const swung = useRef(false);
  const batT = useRef(-1);
  const pending = useRef<{ outcome: Outcome; dir: number; sub?: string } | null>(null);
  const flight = useRef({ fromX: 0, fromY: 0, toX: 0, toY: 0, arc: 0, outcome: 'OUT' as Outcome, dur: 0.9 });
  const banner = useRef<Banner | null>(null);

  const inning = useRef(1);
  const outs = useRef(0);
  const balls = useRef(0);
  const strikes = useRef(0);
  const onBase = useRef([false, false, false]);
  const runsFor = useRef(0);
  const runsAgainst = useRef(0);
  const batterIdx = useRef(0);
  const cpuRuns = useRef(0);
  const finalWon = useRef(false);

  const batter = lineup[batterIdx.current % 9];

  const crowd = useMemo(() => {
    let s = 5;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const cols = ['#e8402e', '#ffd23f', '#5aa9e8', '#ffffff', '#ff8a1f', '#9b5de5'];
    return Array.from({ length: 90 }, () => ({ x: r() * W, y: r() * (wallY - 36), c: cols[Math.floor(r() * cols.length)] }));
  }, [W, wallY]);

  const setPhase = (p: Phase) => { phase.current = p; phaseT.current = 0; };

  const showBanner = (text: string, color: string, sub?: string) => { banner.current = { text, color, sub }; };

  const nextBatter = () => { batterIdx.current += 1; balls.current = 0; strikes.current = 0; };

  const addRuns = (n: number) => { runsFor.current += n; };

  const advance = (n: number) => {
    const next = [false, false, false];
    let runs = 0;
    for (let i = 2; i >= 0; i--) {
      if (!onBase.current[i]) continue;
      const dest = i + 1 + n;
      if (dest >= 4) runs += 1;
      else next[dest - 1] = true;
    }
    if (n >= 4) runs += 1;
    else next[n - 1] = true;
    onBase.current = next;
    addRuns(runs);
    return runs;
  };

  const walk = () => {
    const b = onBase.current;
    let runs = 0;
    if (!b[0]) b[0] = true;
    else if (!b[1]) b[1] = true;
    else if (!b[2]) b[2] = true;
    else runs = 1;
    onBase.current = [...b];
    addRuns(runs);
  };

  const newPitch = () => {
    const roll = Math.random();
    const type: PitchType = roll < 0.5 ? 'FASTBALL' : roll < 0.8 ? 'CURVEBALL' : 'CHANGEUP';
    const base = type === 'FASTBALL' ? 0.85 : type === 'CURVEBALL' ? 1.05 : 1.2;
    const dur = base * (1 - 0.035 * (inning.current - 1));
    const inZone = Math.random() < 0.68;
    const ex = inZone ? (Math.random() * 1.8 - 0.9) : (Math.random() < 0.5 ? -1 : 1) * (1.25 + Math.random() * 0.4);
    pitch.current = { type, dur, ex, side: Math.random() < 0.5 ? -1 : 1, t0: time.current };
    swung.current = false;
    pending.current = null;
    batT.current = -1;
    banner.current = null;
    setPhase('pitch');
  };

  const pitchPos = (p: Pitch, t: number) => {
    const startOff = p.type === 'CURVEBALL' ? p.side * 58 : p.type === 'CHANGEUP' ? p.side * 14 : 0;
    const x = cx + startOff * (1 - t) * (1 - t) + p.ex * ZONE_HALF * (1 - (1 - t) * (1 - t));
    const y = moundY + (homeY - 6 - moundY) * t;
    return { x, y, size: 9 + 27 * t };
  };

  const endOfPlay = (outcome: Outcome, text: string, color: string, sub?: string) => {
    showBanner(text, color, sub);
    setPhase('result');
    void outcome;
  };

  const resolveCall = (outcome: Outcome) => {
    // outcome is BALL, STRIKE or MISS (a swing and miss) here
    if (outcome === 'BALL') {
      balls.current += 1;
      if (balls.current >= 4) {
        walk();
        endOfPlay(outcome, 'WALK', theme.yellow, 'Take your base');
        nextBatter();
        return;
      }
      endOfPlay(outcome, 'BALL', '#cfe4fa', `${balls.current}-${strikes.current}`);
      return;
    }
    strikes.current += 1;
    if (strikes.current >= 3) {
      outs.current += 1;
      endOfPlay(outcome, 'STRIKEOUT', '#ff6b6b', outcome === 'MISS' ? 'Swinging' : 'Looking');
      nextBatter();
      return;
    }
    endOfPlay(outcome, outcome === 'MISS' ? 'SWING & MISS' : 'STRIKE', '#ffb74d', outcome === 'MISS' ? pending.current?.sub : `${balls.current}-${strikes.current}`);
  };

  const finishHalf = () => {
    if (outs.current >= 3) {
      outs.current = 0;
      onBase.current = [false, false, false];
      balls.current = 0;
      strikes.current = 0;
      const gauss = (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;
      cpuRuns.current = Math.max(0, Math.round(0.9 + (oppOvr - 58) / 34 + gauss));
      runsAgainst.current += cpuRuns.current;
      setPhase('cpu');
      return true;
    }
    return false;
  };

  const startFlight = (outcome: Outcome, dir: number, fromX: number, fromY: number) => {
    const reach = (f: number) => cx + dir * W * f;
    let to = { x: reach(0.08), y: homeY - 60, arc: 20, dur: 0.55 };
    if (outcome === 'HR') to = { x: reach(0.3), y: wallY - 60, arc: 110, dur: 1.15 };
    else if (outcome === '3B') to = { x: reach(0.38), y: wallY + 36, arc: 80, dur: 1.0 };
    else if (outcome === '2B') to = { x: reach(0.28), y: wallY + 90, arc: 70, dur: 0.95 };
    else if (outcome === '1B') to = { x: reach(0.2), y: centerY - 20, arc: 46, dur: 0.8 };
    else if (outcome === 'OUT') to = Math.random() < 0.5 ? { x: reach(0.14), y: centerY + 10, arc: 12, dur: 0.6 } : { x: reach(0.22), y: wallY + 70, arc: 90, dur: 1.0 };
    else if (outcome === 'FOUL') to = { x: cx + (dir || 1) * W * 0.62, y: homeY - 70, arc: 50, dur: 0.7 };
    flight.current = { fromX, fromY, toX: to.x, toY: to.y, arc: to.arc, outcome, dur: to.dur };
    setPhase('flight');
  };

  const afterFlight = () => {
    const o = flight.current.outcome;
    const p = pending.current;
    if (o === 'FOUL') {
      if (strikes.current < 2) strikes.current += 1;
      endOfPlay(o, 'FOUL BALL', '#ffb74d', `${balls.current}-${strikes.current}`);
      return;
    }
    if (o === 'OUT') {
      outs.current += 1;
      endOfPlay(o, p?.sub ?? 'OUT', '#ff6b6b', `${outs.current} out`);
      nextBatter();
      return;
    }
    const bases = o === 'HR' ? 4 : o === '3B' ? 3 : o === '2B' ? 2 : 1;
    const runs = advance(bases);
    const label = o === 'HR' ? 'HOME RUN!' : o === '3B' ? 'TRIPLE!' : o === '2B' ? 'DOUBLE!' : 'SINGLE!';
    endOfPlay(o, label, o === 'HR' ? theme.yellow : '#9ee6a8', runs ? `${runs} run${runs > 1 ? 's' : ''} score` : undefined);
    nextBatter();
  };

  const tick = (dt: number) => {
    time.current += dt;
    phaseT.current += dt;
    if (batT.current >= 0) batT.current += dt;
    const ph = phase.current;

    if (ph === 'wait') {
      if (phaseT.current > 1.0) newPitch();
    } else if (ph === 'pitch') {
      const p = pitch.current!;
      const t = (time.current - p.t0) / p.dur;
      if (t >= 1 + WINDOW / p.dur + 0.04) {
        // the ball is by: called or swung already resolved
        if (swung.current && pending.current) {
          resolveCall('MISS');
        } else if (!swung.current) {
          resolveCall(Math.abs(p.ex) <= 1 ? 'STRIKE' : 'BALL');
        }
      }
    } else if (ph === 'flight') {
      if (phaseT.current >= flight.current.dur) afterFlight();
    } else if (ph === 'result') {
      if (phaseT.current > 1.15) {
        if (!finishHalf()) setPhase('wait');
      }
    } else if (ph === 'cpu') {
      if (phaseT.current > 1.5) {
        const done = inning.current >= INNINGS && runsFor.current !== runsAgainst.current;
        if (done) {
          finalWon.current = runsFor.current > runsAgainst.current;
          setPhase('final');
        } else {
          inning.current += 1;
          setPhase('wait');
        }
      }
    }
    render();
  };

  useGameLoop(tick, true);

  const swing = (tapX: number) => {
    if (phase.current !== 'pitch' || swung.current) return;
    const p = pitch.current!;
    swung.current = true;
    batT.current = 0;
    const elapsed = time.current - p.t0;
    const delta = elapsed - p.dur; // negative = early
    const ballArriveX = cx + p.ex * ZONE_HALF;
    const locErr = Math.abs(tapX - ballArriveX) / 72;
    const tq = 1 - Math.abs(delta) / WINDOW;
    const lq = 1 - locErr;
    const timingLabel = delta < 0 ? 'TOO EARLY' : 'TOO LATE';

    if (tq <= 0 || lq <= 0) {
      pending.current = { outcome: 'MISS', dir: 0, sub: tq <= 0 ? timingLabel : 'MISSED THE BALL' };
      return;
    }
    const b = lineup[batterIdx.current % 9];
    const q = Math.max(0, Math.min(1, 0.65 * tq + 0.35 * lq + (b.contact - 60) / 220));
    const dir = Math.max(-1, Math.min(1, -delta / WINDOW)) * 0.8 + (Math.random() - 0.5) * 0.3;
    const here = pitchPos(p, Math.min(1, elapsed / p.dur));

    let outcome: Outcome;
    let sub: string | undefined;
    if (q < 0.22) {
      if (Math.random() < 0.55) outcome = 'FOUL';
      else { outcome = 'OUT'; sub = 'WEAK GROUNDER'; }
    } else {
      const hitProb = 0.3 + q * 0.5 + (b.contact - 50) / 250;
      if (Math.random() > hitProb) {
        outcome = 'OUT';
        sub = Math.random() < 0.5 ? 'GROUNDOUT' : 'FLYOUT';
      } else {
        const e = q * 0.55 + (b.power / 100) * 0.45 + (Math.random() - 0.5) * 0.2 + (tq > 0.85 ? 0.08 : 0);
        outcome = e > 0.86 ? 'HR' : e > 0.72 ? (Math.random() < b.speed / 230 ? '3B' : '2B') : e > 0.52 ? '2B' : '1B';
      }
    }
    pending.current = { outcome, dir, sub };
    startFlight(outcome, dir, here.x, here.y);
  };

  const onGrant = (e: GestureResponderEvent) => swing(e.nativeEvent.pageX);

  useEffect(() => {
    if (RNPlatform.OS !== 'web') return;
    const dn = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') swing(cx); };
    window.addEventListener('keydown', dn);
    return () => window.removeEventListener('keydown', dn);
  }, [cx]);

  // ---- render ----
  const p = pitch.current;
  const ph = phase.current;
  const ballNow = (() => {
    if (ph === 'pitch' && p) {
      const t = Math.min(1.08, (time.current - p.t0) / p.dur);
      return pitchPos(p, t);
    }
    if (ph === 'flight') {
      const f = flight.current;
      const t = Math.min(1, phaseT.current / f.dur);
      const e = 1 - (1 - t) * (1 - t);
      const x = f.fromX + (f.toX - f.fromX) * e;
      const y = f.fromY + (f.toY - f.fromY) * e - Math.sin(Math.PI * t) * f.arc;
      return { x, y, size: Math.max(7, 30 - 22 * t) + Math.sin(Math.PI * t) * 6 };
    }
    return null;
  })();
  const shadow = ph === 'flight' && ballNow ? (() => {
    const f = flight.current;
    const t = Math.min(1, phaseT.current / f.dur);
    const e = 1 - (1 - t) * (1 - t);
    return { x: f.fromX + (f.toX - f.fromX) * e, y: f.fromY + (f.toY - f.fromY) * e };
  })() : null;

  const bannerNow = ph === 'result' ? banner.current : null;
  const batAngle = BAT_ANGLE(batT.current);
  const showBat = ph !== 'cpu' && ph !== 'final';

  return (
    <View style={styles.root} onStartShouldSetResponder={() => true} onResponderGrant={onGrant}>
      {/* stands + wall */}
      <LinearGradient colors={['#3b2a5e', '#5a4890']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: wallY }} />
      {crowd.map((c, i) => <View key={i} style={{ position: 'absolute', left: c.x, top: c.y + 24, width: 5, height: 5, borderRadius: 3, backgroundColor: c.c, opacity: 0.8 }} />)}
      <View style={{ position: 'absolute', left: 0, right: 0, top: wallY - 8, height: 30, backgroundColor: '#1f5a34', borderTopWidth: 3, borderBottomWidth: 3, borderColor: theme.ink, flexDirection: 'row' }}>
        {TEAMS.slice(0, 8).map((t) => <View key={t.id} style={{ flex: 1, marginVertical: 4, marginHorizontal: 2, backgroundColor: t.color, opacity: 0.9, borderRadius: 2 }} />)}
      </View>
      {/* field */}
      <LinearGradient colors={['#4fb36a', '#3a9a56']} style={{ position: 'absolute', left: 0, right: 0, top: wallY + 22, bottom: 0 }} />
      {Array.from({ length: 12 }, (_, i) => (
        <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: wallY + 22 + i * 64, height: 32, backgroundColor: 'rgba(255,255,255,0.05)' }} />
      ))}
      {/* infield */}
      <View style={{ position: 'absolute', left: cx - diagHalf * 0.72, top: centerY - diagHalf * 0.72, width: diagHalf * 1.44, height: diagHalf * 1.44, backgroundColor: '#c98f5a', borderWidth: 3, borderColor: 'rgba(255,255,255,0.8)', transform: [{ rotate: '45deg' }] }}>
        <View style={{ position: 'absolute', left: '16%', right: '16%', top: '16%', bottom: '16%', backgroundColor: '#4fb36a' }} />
      </View>
      <View style={{ position: 'absolute', left: cx - 26, top: moundY - 16, width: 52, height: 32, borderRadius: 26, backgroundColor: '#c98f5a', borderWidth: 2, borderColor: 'rgba(59,42,63,0.4)' }} />

      {/* bases */}
      {bases.map((b, i) => (
        <View key={i} style={{ position: 'absolute', left: b.x - 12, top: b.y - 12, width: 24, height: 24, backgroundColor: onBase.current[i] ? theme.yellow : '#fff', borderWidth: 2.5, borderColor: theme.ink, transform: [{ rotate: '45deg' }] }} />
      ))}
      <View style={{ position: 'absolute', left: cx - 14, top: homeY - 10, width: 28, height: 22, backgroundColor: '#fff', borderWidth: 2.5, borderColor: theme.ink, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }} />
      {onBase.current.map((on, i) => on && (
        <View key={`r${i}`} style={{ position: 'absolute', left: bases[i].x - 13, top: bases[i].y - 50 }}>
          <Runner size={46} cycle={time.current * 6 + i} jersey={TEAMS[0].color} cap={TEAMS[0].accent} />
        </View>
      ))}

      {/* pitcher */}
      <View style={{ position: 'absolute', left: cx - 12, top: moundY - 46 }}>
        <Runner size={44} cycle={0} jersey={oppTeam.color} cap={oppTeam.accent} />
      </View>

      {/* strike zone */}
      <View style={{ position: 'absolute', left: cx - ZONE_HALF, top: homeY - 40, width: ZONE_HALF * 2, height: 52, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)', borderStyle: 'dashed', borderRadius: 4 }} />

      {/* batter */}
      {showBat && (
        <View style={{ position: 'absolute', left: cx - 78, top: homeY - 52 }}>
          <Runner size={74} cycle={0} jersey={batter.team.color} cap={batter.team.accent} />
          <View style={{ position: 'absolute', left: 46, top: 18, width: 8, height: 62, borderRadius: 4, backgroundColor: '#d9a066', borderWidth: 2, borderColor: theme.ink, transformOrigin: 'bottom', transform: [{ rotate: `${batAngle}deg` }] }} />
        </View>
      )}

      {shadow && <View style={{ position: 'absolute', left: shadow.x - 8, top: shadow.y + 8, width: 16, height: 6, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.25)' }} />}
      {ballNow && (
        <View style={{ position: 'absolute', left: ballNow.x - ballNow.size / 2, top: ballNow.y - ballNow.size / 2, width: ballNow.size, height: ballNow.size, borderRadius: ballNow.size / 2, backgroundColor: '#fff', borderWidth: Math.max(1.5, ballNow.size / 12), borderColor: theme.ink, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: -ballNow.size * 0.55, top: ballNow.size * 0.1, width: ballNow.size * 0.6, height: ballNow.size * 0.75, borderRadius: ballNow.size, borderWidth: 1.2, borderColor: theme.red }} />
          <View style={{ position: 'absolute', right: -ballNow.size * 0.55, top: ballNow.size * 0.1, width: ballNow.size * 0.6, height: ballNow.size * 0.75, borderRadius: ballNow.size, borderWidth: 1.2, borderColor: theme.red }} />
        </View>
      )}

      {ph === 'pitch' && p && time.current - p.t0 < 0.45 && (
        <View style={styles.pitchTag} pointerEvents="none"><Text style={styles.pitchTagText}>{p.type}</Text></View>
      )}

      {/* scoreboard */}
      <View style={styles.hud} pointerEvents="none">
        <View style={styles.scoreBox}>
          <Text style={styles.hudLabel}>INN</Text>
          <StrokedText size={22} width={2}>{inning.current > INNINGS ? `${inning.current}X` : String(inning.current)}</StrokedText>
        </View>
        <View style={[styles.scoreBox, { minWidth: 138 }]}>
          <View style={styles.scoreRow}>
            <Text style={styles.hudLabel}>YOU</Text>
            <StrokedText size={24} width={2}>{runsFor.current}</StrokedText>
          </View>
          <View style={styles.scoreRow}>
            <Text style={styles.hudLabel}>{oppTeam.name.toUpperCase().slice(0, 8)}</Text>
            <StrokedText size={24} width={2}>{runsAgainst.current}</StrokedText>
          </View>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.hudLabel}>B-S</Text>
          <StrokedText size={22} width={2}>{`${balls.current}-${strikes.current}`}</StrokedText>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
            {[0, 1, 2].map((i) => <View key={i} style={[styles.out, i < outs.current && { backgroundColor: theme.red }]} />)}
          </View>
        </View>
      </View>

      <Pressable style={styles.exit} onPress={onExit} hitSlop={12} accessibilityLabel="Quit game">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>

      {/* batter strip */}
      <View style={styles.strip} pointerEvents="none">
        <Text style={styles.stripName}>{batter.first} {batter.last}</Text>
        <Text style={styles.stripStats}>OVR {batter.ovr}  CON {batter.contact}  POW {batter.power}  SPD {batter.speed}</Text>
        {phase.current === 'wait' && batterIdx.current === 0 && inning.current === 1 && <Text style={styles.stripHint}>TAP ON THE BALL AS IT REACHES THE PLATE</Text>}
      </View>

      {bannerNow && (
        <View style={styles.banner} pointerEvents="none">
          <StrokedText size={bannerNow.text.length > 10 ? 34 : 44} color={bannerNow.color} width={3} drop={3}>{bannerNow.text}</StrokedText>
          {bannerNow.sub && <StrokedText size={13} font={fonts.pixelBold} width={2}>{bannerNow.sub}</StrokedText>}
        </View>
      )}

      {ph === 'cpu' && (
        <View style={styles.interstitial} pointerEvents="none">
          <StrokedText size={20} font={fonts.pixelBold} width={2}>{`BOTTOM OF ${inning.current}`}</StrokedText>
          <StrokedText size={34} color={cpuRuns.current ? '#ff8a8a' : '#9ee6a8'} width={3} drop={3}>{cpuRuns.current ? `${oppTeam.name} score ${cpuRuns.current}` : `${oppTeam.name} go down 1-2-3`}</StrokedText>
        </View>
      )}

      {ph === 'final' && (
        <View style={styles.interstitial}>
          <StrokedText size={50} color={finalWon.current ? theme.yellow : '#ff8a8a'} width={3} drop={3}>{finalWon.current ? 'YOU WIN!' : 'YOU LOSE'}</StrokedText>
          <StrokedText size={30} width={2.5}>{`${runsFor.current} - ${runsAgainst.current}`}</StrokedText>
          <View style={{ marginTop: 14 }}>
            <Button3D label="Collect" onPress={() => onFinish({ won: finalWon.current, runsFor: runsFor.current, runsAgainst: runsAgainst.current })} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#3a9a56', overflow: 'hidden' },
  hud: { position: 'absolute', top: 44, left: 62, right: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  scoreBox: { backgroundColor: theme.ink, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center', minWidth: 54 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, alignSelf: 'stretch' },
  hudLabel: { fontFamily: fonts.pixelBold, fontSize: 9, color: '#ffb74d', letterSpacing: 1 },
  out: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: '#fff', backgroundColor: 'transparent' },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  strip: { position: 'absolute', left: 14, right: 14, bottom: 26, backgroundColor: 'rgba(59,42,63,0.86)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
  stripName: { fontFamily: fonts.display, fontSize: 20, color: '#fff' },
  stripStats: { fontFamily: fonts.pixelBold, fontSize: 10, color: '#ffb74d', marginTop: 2, letterSpacing: 0.5 },
  stripHint: { fontFamily: fonts.pixel, fontSize: 9, color: '#fff', marginTop: 5, opacity: 0.85 },
  pitchTag: { position: 'absolute', left: 0, right: 0, top: H_TAG, alignItems: 'center' },
  pitchTagText: { fontFamily: fonts.pixelBold, fontSize: 11, color: theme.ink, backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  banner: { position: 'absolute', left: 0, right: 0, top: '44%', alignItems: 'center', gap: 6 },
  interstitial: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: 'rgba(59,42,63,0.6)', paddingHorizontal: 20 },
});


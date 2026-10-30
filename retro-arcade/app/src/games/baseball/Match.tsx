import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Platform as RNPlatform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { useGameLoop } from '../../core/useGameLoop';
import Button3D from '../../ui/Button3D';
import Bust from './Bust';
import { GOLD, NAVY } from './Card';
import { BackButton } from './Chrome';
import Stadium from './Stadium';
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
  const youLine = useRef<number[]>([]);
  const oppLine = useRef<number[]>([]);

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

  const addRuns = (n: number) => {
    runsFor.current += n;
    youLine.current[inning.current - 1] = (youLine.current[inning.current - 1] ?? 0) + n;
  };

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
      oppLine.current[inning.current - 1] = cpuRuns.current;
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
  const ballAt = (t: number) => (p ? pitchPos(p, Math.min(1.08, t)) : null);
  const tNow = p ? (time.current - p.t0) / p.dur : 0;
  const ballNow = (() => {
    if (ph === 'pitch' && p) return ballAt(tNow);
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
  const trail = ph === 'pitch' && p ? [0.05, 0.1, 0.15].map((d) => ballAt(tNow - d / p.dur * 1)).filter(Boolean) : [];
  const shadow = (() => {
    if (ph === 'flight') {
      const f = flight.current;
      const t = Math.min(1, phaseT.current / f.dur);
      const e = 1 - (1 - t) * (1 - t);
      return { x: f.fromX + (f.toX - f.fromX) * e, y: f.fromY + (f.toY - f.fromY) * e, s: 1 - Math.sin(Math.PI * t) * 0.4 };
    }
    if (ph === 'pitch' && ballNow) return { x: ballNow.x, y: ballNow.y + ballNow.size * 0.9, s: 0.6 + tNow * 0.4 };
    return null;
  })();

  const bannerNow = ph === 'result' ? banner.current : null;
  const batAngle = BAT_ANGLE(batT.current);
  const showBat = ph !== 'cpu' && ph !== 'final';
  const cols = Math.max(INNINGS, inning.current);
  const abbr = oppTeam.name.slice(0, 3).toUpperCase();
  const foul = (len: number, angle: number, x: number, y: number, key: string) => (
    <View key={key} pointerEvents="none" style={{ position: 'absolute', left: x - 1.5, top: y - len, width: 3, height: len, backgroundColor: 'rgba(255,255,255,0.85)', transformOrigin: 'bottom', transform: [{ rotate: `${angle}deg` }] }} />
  );
  const leg = diagHalf * Math.SQRT2;

  const led = (text: string | number, on = true, w = 22) => (
    <Text style={[styles.led, { width: w }, !on && { opacity: 0.25 }]}>{text}</Text>
  );
  const lights = (n: number, on: number, color: string) => (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: n }, (_, i) => <View key={i} style={[styles.bulb, { backgroundColor: i < on ? color : '#2a2f45', boxShadow: i < on ? `0px 0px 6px ${color}` : undefined }]} />)}
    </View>
  );

  return (
    <View style={styles.root} onStartShouldSetResponder={() => true} onResponderGrant={onGrant}>
      <Stadium horizon={wallY / H} lights={false} />

      {/* outfield wall + warning track */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: wallY - 12, height: 34, backgroundColor: '#0f4a2a', borderTopWidth: 5, borderTopColor: GOLD, borderBottomWidth: 3, borderBottomColor: theme.ink, flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 3, gap: 3 }}>
        {TEAMS.slice(0, 8).map((t) => (
          <View key={t.id} style={{ flex: 1, backgroundColor: t.color, borderRadius: 2, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' }}>
            <View style={{ height: 2, backgroundColor: t.accent, opacity: 0.8 }} />
          </View>
        ))}
      </View>
      <LinearGradient colors={['#a57738', '#8a5f2b']} style={{ position: 'absolute', left: 0, right: 0, top: wallY + 22, height: 22 }} />

      {/* infield dirt, grass and chalk */}
      <View style={{ position: 'absolute', left: cx - diagHalf * 0.98, top: centerY + diagHalf * 0.08 - diagHalf * 0.98, width: diagHalf * 1.96, height: diagHalf * 1.96, borderRadius: diagHalf, backgroundColor: '#b8803f' }} />
      <View style={{ position: 'absolute', left: cx - diagHalf * 0.5, top: centerY - diagHalf * 0.5, width: diagHalf, height: diagHalf, backgroundColor: '#2a7f46', transform: [{ rotate: '45deg' }], borderRadius: 6 }} />
      {foul(leg * 1.9, 45, cx, homeY, 'f1')}
      {foul(leg * 1.9, -45, cx, homeY, 'f2')}
      {foul(leg, -45, bases[0].x, bases[0].y, 'b1')}
      {foul(leg, 45, bases[2].x, bases[2].y, 'b2')}
      <View style={{ position: 'absolute', left: cx - 48, top: homeY - 48, width: 96, height: 96, borderRadius: 48, backgroundColor: '#b8803f' }} />
      {[-1, 1].map((s) => <View key={s} style={{ position: 'absolute', left: cx + s * 40 - 13, top: homeY - 34, width: 26, height: 56, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' }} />)}
      <View style={{ position: 'absolute', left: cx - 30, top: moundY - 20, width: 60, height: 40, borderRadius: 30, backgroundColor: '#a06f33' }} />
      <View style={{ position: 'absolute', left: cx - 10, top: moundY - 2, width: 20, height: 4, backgroundColor: '#fff', borderRadius: 1 }} />

      {/* bases */}
      {bases.map((b, i) => (
        <View key={i} style={{ position: 'absolute', left: b.x - 12, top: b.y - 12, width: 24, height: 24, backgroundColor: onBase.current[i] ? GOLD : '#fff', borderWidth: 2.5, borderColor: theme.ink, transform: [{ rotate: '45deg' }], boxShadow: '2px 3px 0px rgba(0,0,0,0.3)' }} />
      ))}
      <View style={{ position: 'absolute', left: cx - 15, top: homeY - 11, width: 30, height: 24, backgroundColor: '#fff', borderWidth: 2.5, borderColor: theme.ink, borderBottomLeftRadius: 9, borderBottomRightRadius: 9 }} />
      {onBase.current.map((on, i) => on && (
        <View key={`r${i}`} style={{ position: 'absolute', left: bases[i].x - 14, top: bases[i].y - 56 }}>
          <View style={styles.shadow} />
          <Runner size={52} cycle={time.current * 6 + i} jersey={lineup[0].team.color} cap={lineup[0].team.accent} />
        </View>
      ))}

      {/* pitcher */}
      <View style={{ position: 'absolute', left: cx - 17, top: moundY - 52 }}>
        <Pitcher s={56} team={oppTeam} wind={ph === 'wait' ? Math.min(1, phaseT.current / 0.9) : ph === 'pitch' && tNow < 0.15 ? 1 : 0} />
      </View>

      {/* strike zone */}
      <View style={{ position: 'absolute', left: cx - ZONE_HALF, top: homeY - 40, width: ZONE_HALF * 2, height: 52, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', borderStyle: 'dashed', borderRadius: 4 }} />

      {/* batter */}
      {showBat && (
        <View style={{ position: 'absolute', left: cx - 86, top: homeY - 66 }}>
          <View style={[styles.shadow, { left: 10, width: 54 }]} />
          <Runner size={92} cycle={0} jersey={batter.team.color} cap={batter.team.accent} />
          <View style={{ position: 'absolute', left: 56, top: 24, width: 9, height: 74, borderRadius: 5, backgroundColor: '#e2b070', borderWidth: 2, borderColor: theme.ink, transformOrigin: 'bottom', transform: [{ rotate: `${batAngle}deg` }] }} />
        </View>
      )}

      {shadow && <View style={{ position: 'absolute', left: shadow.x - 9 * shadow.s, top: shadow.y + 6, width: 18 * shadow.s, height: 7 * shadow.s, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.3)' }} />}
      {trail.map((t, i) => t && (
        <View key={i} style={{ position: 'absolute', left: t.x - t.size / 2, top: t.y - t.size / 2, width: t.size, height: t.size, borderRadius: t.size / 2, backgroundColor: '#fff', opacity: 0.28 - i * 0.08 }} />
      ))}
      {ballNow && (
        <View style={{ position: 'absolute', left: ballNow.x - ballNow.size / 2, top: ballNow.y - ballNow.size / 2, width: ballNow.size, height: ballNow.size, borderRadius: ballNow.size / 2, backgroundColor: '#fff', borderWidth: Math.max(1.5, ballNow.size / 12), borderColor: theme.ink, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: -ballNow.size * 0.55, top: ballNow.size * 0.1, width: ballNow.size * 0.6, height: ballNow.size * 0.75, borderRadius: ballNow.size, borderWidth: 1.2, borderColor: theme.red }} />
          <View style={{ position: 'absolute', right: -ballNow.size * 0.55, top: ballNow.size * 0.1, width: ballNow.size * 0.6, height: ballNow.size * 0.75, borderRadius: ballNow.size, borderWidth: 1.2, borderColor: theme.red }} />
        </View>
      )}

      {ph === 'pitch' && p && time.current - p.t0 < 0.5 && (
        <View style={styles.pitchTag} pointerEvents="none"><Text style={styles.pitchTagText}>{p.type}</Text></View>
      )}

      {/* LED scoreboard */}
      <View style={styles.board} pointerEvents="none">
        <View style={{ flex: 1 }}>
          <View style={styles.lineRow}>
            {led('', true, 40)}
            {Array.from({ length: cols }, (_, i) => led(i + 1, i < inning.current, 20))}
            {led('R', true, 24)}
          </View>
          <View style={styles.lineRow}>
            {led('YOU', true, 40)}
            {Array.from({ length: cols }, (_, i) => led(i < inning.current ? (youLine.current[i] ?? 0) : '·', i < inning.current, 20))}
            {led(runsFor.current, true, 24)}
          </View>
          <View style={styles.lineRow}>
            {led(abbr, true, 40)}
            {Array.from({ length: cols }, (_, i) => led(i < inning.current - 1 || (i === inning.current - 1 && ph === 'cpu') ? (oppLine.current[i] ?? 0) : '·', i < inning.current, 20))}
            {led(runsAgainst.current, true, 24)}
          </View>
        </View>
        <View style={styles.bso}>
          <View style={styles.bsoRow}><Text style={styles.bsoLabel}>B</Text>{lights(3, balls.current, '#46e07a')}</View>
          <View style={styles.bsoRow}><Text style={styles.bsoLabel}>S</Text>{lights(2, strikes.current, '#ffb02e')}</View>
          <View style={styles.bsoRow}><Text style={styles.bsoLabel}>O</Text>{lights(2, outs.current, '#ff4d3d')}</View>
        </View>
      </View>

      <BackButton onPress={onExit} label="Quit game" />

      {/* batter plate */}
      <View style={styles.strip} pointerEvents="none">
        <View style={[styles.stripFace, { backgroundColor: batter.team.color }]}>
          <View style={{ position: 'absolute', left: -4, top: 4 }}><Bust p={batter} w={58} /></View>
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.stripName}>{batter.first} {batter.last}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 3 }}>
            {[['CON', batter.contact], ['POW', batter.power], ['SPD', batter.speed]].map(([l, v]) => (
              <View key={l as string} style={styles.chip}><Text style={styles.chipLabel}>{l}</Text><Text style={styles.chipValue}>{v}</Text></View>
            ))}
          </View>
        </View>
        <View style={styles.ovr}><Text style={styles.ovrNum}>{batter.ovr}</Text><Text style={styles.ovrPos}>{batter.pos}</Text></View>
      </View>
      {phase.current === 'wait' && batterIdx.current === 0 && inning.current === 1 && (
        <Text style={styles.hint} pointerEvents="none">TAP WHERE THE BALL ARRIVES, THE MOMENT IT ARRIVES</Text>
      )}

      {bannerNow && (
        <View style={styles.stinger} pointerEvents="none">
          <View style={styles.stingerBand}>
            <View style={styles.stingerRule} />
            <StrokedText size={bannerNow.text.length > 10 ? 36 : 46} color={bannerNow.color} width={3} drop={3}>{bannerNow.text}</StrokedText>
            {bannerNow.sub && <Text style={styles.stingerSub}>{bannerNow.sub.toUpperCase()}</Text>}
            <View style={styles.stingerRule} />
          </View>
        </View>
      )}

      {ph === 'cpu' && (
        <View style={styles.interstitial} pointerEvents="none">
          <Text style={styles.interLabel}>{`BOTTOM OF INNING ${inning.current}`}</Text>
          <StrokedText size={36} color={cpuRuns.current ? '#ff8a8a' : '#7ee08f'} width={3} drop={3}>{cpuRuns.current ? `${oppTeam.name} score ${cpuRuns.current}` : `${oppTeam.name} go down 1-2-3`}</StrokedText>
        </View>
      )}

      {ph === 'final' && (
        <View style={styles.interstitial}>
          <StrokedText size={52} color={finalWon.current ? GOLD : '#ff8a8a'} width={3.5} drop={4}>{finalWon.current ? 'YOU WIN!' : 'YOU LOSE'}</StrokedText>
          <StrokedText size={34} width={3}>{`${runsFor.current} – ${runsAgainst.current}`}</StrokedText>
          <View style={{ marginTop: 14 }}>
            <Button3D label="Collect" onPress={() => onFinish({ won: finalWon.current, runsFor: runsFor.current, runsAgainst: runsAgainst.current })} face={GOLD} lip="#b8860b" textColor={NAVY} stroke="#fff3b0" strokeWidth={1.5} />
          </View>
        </View>
      )}
    </View>
  );
}

/** Front-facing pitcher: jersey, glove, cap. `wind` raises the arm for the delivery. */
function Pitcher({ s, team, wind }: { s: number; team: Team; wind: number }) {
  const w = s * 0.62;
  const b = Math.max(1.5, s / 30);
  return (
    <View style={{ width: w, height: s }}>
      <View style={[styles.shadow, { left: 0, width: w, top: s - 6 }]} />
      {[0.14, 0.5].map((x) => <View key={x} style={{ position: 'absolute', left: w * x, top: s * 0.62, width: w * 0.36, height: s * 0.36, borderRadius: 4, backgroundColor: '#e9edf5', borderWidth: b, borderColor: theme.ink }} />)}
      <View style={{ position: 'absolute', left: w * 0.06, top: s * 0.3, width: w * 0.88, height: s * 0.4, borderRadius: w * 0.22, backgroundColor: team.color, borderWidth: b, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '35%', backgroundColor: 'rgba(255,255,255,0.15)' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: s * 0.05, backgroundColor: team.accent }} />
      </View>
      <View style={{ position: 'absolute', left: -w * 0.12, top: s * 0.34 - wind * s * 0.3, width: w * 0.22, height: s * 0.3, borderRadius: w * 0.1, backgroundColor: team.color, borderWidth: b, borderColor: theme.ink, transform: [{ rotate: `${wind * -22}deg` }] }}>
        <View style={{ position: 'absolute', left: -3, top: -s * 0.1, width: w * 0.3, height: w * 0.3, borderRadius: w * 0.15, backgroundColor: '#7a4a22', borderWidth: b, borderColor: theme.ink }} />
      </View>
      <View style={{ position: 'absolute', right: -w * 0.08, top: s * 0.38, width: w * 0.2, height: s * 0.26, borderRadius: w * 0.1, backgroundColor: team.color, borderWidth: b, borderColor: theme.ink }} />
      <View style={{ position: 'absolute', left: w * 0.24, top: s * 0.08, width: w * 0.52, height: w * 0.52, borderRadius: w * 0.26, backgroundColor: '#e0a878', borderWidth: b, borderColor: theme.ink }}>
        {[0.2, 0.62].map((x) => <View key={x} style={{ position: 'absolute', left: `${x * 100}%`, top: '45%', width: 3, height: 3, borderRadius: 2, backgroundColor: theme.ink }} />)}
      </View>
      <View style={{ position: 'absolute', left: w * 0.2, top: s * 0.02, width: w * 0.6, height: w * 0.3, borderTopLeftRadius: w * 0.3, borderTopRightRadius: w * 0.3, backgroundColor: team.color, borderWidth: b, borderColor: theme.ink }} />
      <View style={{ position: 'absolute', left: w * 0.16, top: s * 0.1, width: w * 0.68, height: w * 0.1, borderRadius: 4, backgroundColor: team.color, borderWidth: b, borderColor: theme.ink }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f6b3d', overflow: 'hidden' },
  shadow: { position: 'absolute', left: 8, top: '88%', width: 40, height: 10, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.28)' },
  board: { position: 'absolute', top: 40, left: 62, right: 10, flexDirection: 'row', gap: 10, backgroundColor: '#070a18', borderRadius: 10, borderWidth: 2.5, borderColor: '#2a2f45', paddingVertical: 5, paddingHorizontal: 8, boxShadow: '0px 4px 0px rgba(0,0,0,0.4)' },
  lineRow: { flexDirection: 'row', alignItems: 'center', height: 18 },
  led: { fontFamily: fonts.pixelBold, fontSize: 11, color: '#ffb02e', textAlign: 'center', textShadowColor: 'rgba(255,176,46,0.75)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } },
  bso: { justifyContent: 'center', gap: 3, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: '#2a2f45' },
  bsoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bsoLabel: { width: 10, fontFamily: fonts.pixelBold, fontSize: 9, color: '#9aa3c4' },
  bulb: { width: 11, height: 11, borderRadius: 6, borderWidth: 1, borderColor: '#0a0c18' },
  strip: { position: 'absolute', left: 12, right: 12, bottom: 22, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: NAVY, borderRadius: 16, borderWidth: 3, borderColor: GOLD, paddingVertical: 7, paddingLeft: 8, paddingRight: 12, boxShadow: '0px 5px 0px rgba(0,0,0,0.4)' },
  stripFace: { width: 50, height: 50, borderRadius: 25, borderWidth: 3, borderColor: '#fff', overflow: 'hidden' },
  stripName: { fontFamily: fonts.display, fontSize: 20, color: '#fff' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1b2a5c', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  chipLabel: { fontFamily: fonts.pixelBold, fontSize: 7, color: '#8f9bc0' },
  chipValue: { fontFamily: fonts.display, fontSize: 13, color: '#fff' },
  ovr: { alignItems: 'center', minWidth: 42 },
  ovrNum: { fontFamily: fonts.display, fontSize: 28, lineHeight: 30, color: GOLD },
  ovrPos: { fontFamily: fonts.pixelBold, fontSize: 9, color: '#8f9bc0' },
  hint: { position: 'absolute', left: 0, right: 0, bottom: 100, textAlign: 'center', fontFamily: fonts.pixelBold, fontSize: 9, color: '#fff', textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 1, height: 1 } },
  pitchTag: { position: 'absolute', left: 0, right: 0, top: 112, alignItems: 'center' },
  pitchTagText: { fontFamily: fonts.pixelBold, fontSize: 11, color: GOLD, backgroundColor: 'rgba(7,10,24,0.85)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4, overflow: 'hidden', letterSpacing: 1 },
  stinger: { position: 'absolute', left: -20, right: -20, top: '38%', transform: [{ rotate: '-3deg' }] },
  stingerBand: { backgroundColor: 'rgba(7,10,24,0.88)', paddingVertical: 8, alignItems: 'center', gap: 4 },
  stingerRule: { alignSelf: 'stretch', height: 3, backgroundColor: GOLD },
  stingerSub: { fontFamily: fonts.pixelBold, fontSize: 11, color: '#fff', letterSpacing: 1.5 },
  interstitial: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: 'rgba(7,10,24,0.82)', paddingHorizontal: 20 },
  interLabel: { fontFamily: fonts.pixelBold, fontSize: 12, color: GOLD, letterSpacing: 2 },
});


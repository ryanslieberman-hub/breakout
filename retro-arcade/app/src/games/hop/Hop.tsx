import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Platform as RNPlatform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { getHighScore, submitScore } from '../../core/scores';
import type { GameProps } from '../../core/types';
import { useGameLoop } from '../../core/useGameLoop';
import ScoreBoard from '../../ui/ScoreBoard';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import { Cloud } from '../flappy/Scenery';
import Hopper from './Hopper';
import Platform, { PLAT_H, PLAT_W, type PlatformKind } from './Platform';

const GAME_ID = 'hop';
const GRAVITY = 1500;
const JUMP = -720;
const SPRING = -1150;
const SIZE = 46;
const HALF_W = 14;
const KEY_SPEED = 520;

type Phase = 'ready' | 'playing' | 'over';
interface Plat {
  kind: PlatformKind;
  x: number;
  y: number;
  baseX: number;
  amp: number;
  speed: number;
  phase: number;
  broken: boolean;
  fall: number;
  sprung: number;
  /** Set only on the full-width launch pad. */
  w?: number;
}

const SKY = [
  { s: 0, top: '#2ba7d9', bot: '#c9f0ee' },
  { s: 70, top: '#7a52b8', bot: '#ffb27a' },
  { s: 150, top: '#1a1745', bot: '#4b3a8c' },
  { s: 260, top: '#07081f', bot: '#1d2260' },
];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
function skyAt(score: number) {
  let i = SKY.length - 2;
  for (let k = 0; k < SKY.length - 1; k++) if (score < SKY[k + 1].s) { i = k; break; }
  const a = SKY[i];
  const b = SKY[i + 1];
  const t = Math.max(0, Math.min(1, (score - a.s) / (b.s - a.s)));
  return { top: mix(a.top, b.top, t), bot: mix(a.bot, b.bot, t), night: Math.max(0, Math.min(1, (score - 90) / 120)) };
}

const STARS = Array.from({ length: 26 }, (_, i) => ({ x: ((i * 97) % 100) / 100, y: ((i * 53) % 100) / 100, s: 2 + (i % 3) }));
const CLOUDS = [0, 1, 2, 3, 4].map((i) => ({ x: (i * 173) % 300, y: i * 190, scale: 0.7 + (i % 3) * 0.25 }));

export default function Hop({ onExit }: GameProps) {
  const { width: W, height: H } = useWindowDimensions();
  const startY = H - 130;

  const [phase, setPhase] = useState<Phase>('ready');
  const [best, setBest] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const [, render] = useReducer((n: number) => n + 1, 0);

  const phaseRef = useRef<Phase>('ready');
  const bestRef = useRef(0);
  const px = useRef(W / 2);
  const py = useRef(startY - SIZE / 2);
  const vel = useRef(0);
  const targetX = useRef(W / 2);
  const camTop = useRef(0);
  const plats = useRef<Plat[]>([]);
  const topY = useRef(0);
  const lastKind = useRef<PlatformKind>('grass');
  const minPy = useRef(py.current);
  const score = useRef(0);
  const time = useRef(0);
  const look = useRef(1);
  const squash = useRef(0);
  const keys = useRef({ left: false, right: false });

  useEffect(() => {
    getHighScore(GAME_ID).then((b) => { bestRef.current = b; setBest(b); });
  }, []);

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const spawn = (y: number, forceKind?: PlatformKind) => {
    const diff = Math.min(1, score.current / 220);
    const roll = Math.random();
    let kind: PlatformKind = 'grass';
    if (forceKind) kind = forceKind;
    else if (roll < 0.1 + diff * 0.22 && lastKind.current !== 'crumble') kind = 'crumble';
    else if (roll < 0.28 + diff * 0.3) kind = 'moving';
    else if (roll < 0.36 + diff * 0.3) kind = 'spring';
    lastKind.current = kind;
    const amp = kind === 'moving' ? 34 + Math.random() * 30 : 0;
    const lo = amp + 8;
    const hi = W - PLAT_W - amp - 8;
    const baseX = lo + Math.random() * Math.max(1, hi - lo);
    plats.current.push({ kind, x: baseX, y, baseX, amp, speed: 1.2 + Math.random() * 1.2, phase: Math.random() * 6, broken: false, fall: 0, sprung: 0 });
  };

  const fill = () => {
    while (topY.current > camTop.current - 120) {
      const diff = Math.min(1, score.current / 220);
      topY.current -= 56 + Math.random() * (34 + diff * 28);
      spawn(topY.current);
    }
  };

  const reset = useCallback(() => {
    px.current = W / 2;
    targetX.current = W / 2;
    py.current = startY - SIZE / 2;
    vel.current = 0;
    camTop.current = 0;
    minPy.current = py.current;
    score.current = 0;
    squash.current = 0;
    plats.current = [{ kind: 'grass', x: -20, y: startY, baseX: -20, amp: 0, speed: 0, phase: 0, broken: false, fall: 0, sprung: 0, w: W + 40 }];
    topY.current = startY;
    lastKind.current = 'grass';
    fill();
    render();
  }, [W, H]);

  useEffect(reset, [reset]);

  const start = () => {
    if (phaseRef.current !== 'ready') return;
    setPhaseBoth('playing');
    vel.current = JUMP;
  };

  const finish = () => {
    setIsNew(score.current > bestRef.current);
    setPhaseBoth('over');
    submitScore(GAME_ID, score.current).then((b) => { bestRef.current = b; setBest(b); });
    render();
  };

  const tick = (dt: number) => {
    time.current += dt;
    if (squash.current > 0) squash.current -= dt;

    if (phaseRef.current === 'ready') {
      py.current = startY - SIZE / 2 - Math.abs(Math.sin(time.current * 4.5)) * 70;
      return render();
    }

    if (keys.current.left) targetX.current -= KEY_SPEED * dt;
    if (keys.current.right) targetX.current += KEY_SPEED * dt;
    targetX.current = Math.max(HALF_W, Math.min(W - HALF_W, targetX.current));
    const dx = targetX.current - px.current;
    if (Math.abs(dx) > 1.5) look.current = Math.sign(dx);
    px.current += dx * Math.min(1, dt * 14);

    const prevFeet = py.current + SIZE / 2;
    vel.current += GRAVITY * dt;
    py.current += vel.current * dt;
    const feet = py.current + SIZE / 2;

    for (const p of plats.current) {
      if (p.kind === 'moving') p.x = p.baseX + Math.sin(time.current * p.speed + p.phase) * p.amp;
      if (p.broken) { p.fall += 1100 * dt; p.y += p.fall * dt; }
      if (p.sprung > 0) p.sprung -= dt;
    }

    if (vel.current > 0) {
      for (const p of plats.current) {
        if (p.broken) continue;
        const left = p.x;
        const right = p.x + (p.w ?? PLAT_W);
        if (prevFeet <= p.y + 4 && feet >= p.y && px.current + HALF_W > left && px.current - HALF_W < right) {
          if (p.kind === 'crumble') { p.broken = true; continue; }
          vel.current = p.kind === 'spring' ? SPRING : JUMP;
          if (p.kind === 'spring') p.sprung = 0.5;
          squash.current = 0.1;
          py.current = p.y - SIZE / 2;
          break;
        }
      }
    }

    camTop.current = Math.min(camTop.current, py.current - H * 0.42);
    minPy.current = Math.min(minPy.current, py.current);
    score.current = Math.max(score.current, Math.floor((startY - SIZE / 2 - minPy.current) / 8));
    fill();
    plats.current = plats.current.filter((p) => p.y - camTop.current < H + 140);

    if (py.current - camTop.current > H + 60) return finish();
    render();
  };

  useGameLoop(tick, phase !== 'over');

  const aim = (e: GestureResponderEvent) => { targetX.current = e.nativeEvent.pageX; };

  useEffect(() => {
    if (RNPlatform.OS !== 'web') return;
    const set = (e: KeyboardEvent, down: boolean) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.current.left = down;
      else if (e.key === 'ArrowRight' || e.key === 'd') keys.current.right = down;
      else if (e.key === ' ' && down) start();
      else return;
      if (down) start();
    };
    const dn = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  const restart = () => { reset(); setPhaseBoth('ready'); setIsNew(false); };

  const sky = skyAt(score.current);
  const hw = SIZE * 0.86;
  const stretch = squash.current > 0 ? 0.82 : vel.current < 0 ? 1 + Math.min(0.16, -vel.current / 4800) : 1 - Math.min(0.08, vel.current / 7000);

  return (
    <View
      style={styles.root}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => { aim(e); start(); }}
      onResponderMove={aim}
    >
      <LinearGradient colors={[sky.top, sky.bot]} style={StyleSheet.absoluteFill} />

      {STARS.map((st, i) => (
        <View key={i} style={{ position: 'absolute', left: st.x * W, top: st.y * H, width: st.s, height: st.s, borderRadius: st.s, backgroundColor: '#fff', opacity: sky.night * (0.5 + 0.5 * Math.sin(time.current * 2 + i)) }} />
      ))}

      {CLOUDS.map((c, i) => {
        const span = H + 260;
        const y = ((((c.y - camTop.current * 0.35) % span) + span) % span) - 130;
        return <View key={i} style={{ opacity: 1 - sky.night * 0.85 }}><Cloud x={(c.x + i * 40) % (W - 60)} y={y} scale={c.scale} /></View>;
      })}

      {/* launch pad */}
      <View style={{ position: 'absolute', left: -10, top: startY - camTop.current, width: W + 20 }}>
        <Platform kind="grass" width={W + 20} />
        <View style={{ height: H, backgroundColor: '#5fa21d', borderLeftWidth: 2.5, borderRightWidth: 2.5, borderColor: theme.ink, marginTop: -4 }} />
      </View>

      {plats.current.map((p, i) => p.w ? null : (
        <View key={i} style={{ position: 'absolute', left: p.x, top: p.y - camTop.current, opacity: p.broken ? 0.7 : 1, transform: p.broken ? [{ rotate: `${p.fall / 30}deg` }] : undefined }}>
          <Platform kind={p.kind} sprung={p.sprung > 0} />
        </View>
      ))}

      <View style={{ position: 'absolute', left: px.current - hw / 2, top: py.current - SIZE / 2 - camTop.current }}>
        <Hopper size={SIZE} look={look.current} stretch={stretch} />
      </View>

      {phase === 'playing' && (
        <View style={styles.scoreWrap} pointerEvents="none">
          <StrokedText size={56} width={3} drop={3}>{score.current}</StrokedText>
        </View>
      )}

      <Pressable style={styles.exit} onPress={onExit} hitSlop={12} accessibilityLabel="Back to home screen">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>

      {phase === 'ready' && (
        <View style={styles.readyWrap} pointerEvents="none">
          <StrokedText size={46} color={theme.yellow} width={3} drop={3}>Hop Hop!</StrokedText>
          <StrokedText size={16} font={fonts.pixelBold} width={2}>DRAG TO STEER</StrokedText>
          {best > 0 && <StrokedText size={13} font={fonts.pixelBold} color={theme.yellow} width={2}>{`BEST ${best}`}</StrokedText>}
        </View>
      )}

      {phase === 'over' && (
        <ScoreBoard score={score.current} best={best} isNew={isNew} medals={[25, 80, 160]} onPlay={restart} onMenu={onExit} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.sky, overflow: 'hidden' },
  scoreWrap: { position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center' },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  readyWrap: { position: 'absolute', left: 0, right: 0, top: '14%', alignItems: 'center', gap: 16 },
});

import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Platform as RNPlatform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { getHighScore, submitScore } from '../../core/scores';
import type { GameProps } from '../../core/types';
import { useGameLoop } from '../../core/useGameLoop';
import ScoreBoard from '../../ui/ScoreBoard';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import Runner from './Runner';

const GAME_ID = 'dash';
const K = 12; // perspective strength
const Z_MAX = 72;
const BAND = 2.6; // road band length in world units
const PX_PER_UNIT = 30; // jump height scale at depth 0
const GRAVITY = 70;
const JUMP_V = 21;
const SLIDE_TIME = 0.65;
const SWIPE = 26;
const CONTAINERS = ['#e8602c', '#2f7fd6', '#3aa66a', '#9a5bd6'];

type Phase = 'ready' | 'playing' | 'dying' | 'over';
type ObstacleKind = 'wall' | 'low' | 'high';
interface Obstacle { z: number; lane: number; kind: ObstacleKind; color: string }
interface Coin { z: number; lane: number; got: boolean }

const sOf = (z: number) => K / (K + z);

/** A trapezoid made from borders: narrow top, wide bottom. */
function Trapezoid({ left, top, topW, botW, height, color }: { left: number; top: number; topW: number; botW: number; height: number; color: string }) {
  const edge = (botW - topW) / 2;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left, top, width: Math.max(0, topW), height: 0,
        borderBottomWidth: height, borderBottomColor: color,
        borderLeftWidth: edge, borderRightWidth: edge, borderLeftColor: 'transparent', borderRightColor: 'transparent',
      }}
    />
  );
}

export default function LaneDash({ onExit }: GameProps) {
  const { width: W, height: H } = useWindowDimensions();
  const cx = W / 2;
  const horizonY = H * 0.3;
  const bottomY = H * 0.84;
  const laneW = W * 0.27;
  const roadHalf = W * 0.44;
  const yOf = (s: number) => horizonY + (bottomY - horizonY) * s;

  const [phase, setPhase] = useState<Phase>('ready');
  const [best, setBest] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const [, render] = useReducer((n: number) => n + 1, 0);

  const phaseRef = useRef<Phase>('ready');
  const bestRef = useRef(0);
  const time = useRef(0);
  const dist = useRef(0);
  const cycle = useRef(0);
  const lane = useRef(1);
  const laneF = useRef(1);
  const jh = useRef(0);
  const jv = useRef(0);
  const slideT = useRef(0);
  const coinCount = useRef(0);
  const score = useRef(0);
  const obstacles = useRef<Obstacle[]>([]);
  const coins = useRef<Coin[]>([]);
  const spawnZ = useRef(40);
  const dyingT = useRef(0);
  const flash = useRef(0);
  const swipeStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    getHighScore(GAME_ID).then((b) => { bestRef.current = b; setBest(b); });
  }, []);

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const skyline = useMemo(() => {
    const out: { x: number; w: number; h: number }[] = [];
    let x = -10;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    while (x < W + 10) {
      const bw = 22 + rnd() * 34;
      out.push({ x, w: bw, h: 24 + rnd() * 70 });
      x += bw + 1;
    }
    return out;
  }, [W]);

  const reset = useCallback(() => {
    dist.current = 0;
    lane.current = 1;
    laneF.current = 1;
    jh.current = 0;
    jv.current = 0;
    slideT.current = 0;
    coinCount.current = 0;
    score.current = 0;
    obstacles.current = [];
    coins.current = [];
    spawnZ.current = 40;
    flash.current = 0;
    render();
  }, []);

  useEffect(reset, [reset]);

  const addRow = (z: number) => {
    const color = CONTAINERS[Math.floor(Math.random() * CONTAINERS.length)];
    const roll = Math.random();
    let free = Math.floor(Math.random() * 3);
    if (roll < 0.4) {
      const blocked = Math.random() < 0.55 ? 1 : 2;
      const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
      free = lanes[2];
      for (let i = 0; i < blocked; i++) obstacles.current.push({ z, lane: lanes[i], kind: 'wall', color });
      if (blocked === 1) obstacles.current.push({ z, lane: lanes[1], kind: Math.random() < 0.5 ? 'low' : 'high', color });
    } else if (roll < 0.62) {
      [0, 1, 2].forEach((l) => obstacles.current.push({ z, lane: l, kind: 'low', color }));
    } else if (roll < 0.84) {
      [0, 1, 2].forEach((l) => obstacles.current.push({ z, lane: l, kind: 'high', color }));
    } else {
      const l = Math.floor(Math.random() * 3);
      obstacles.current.push({ z, lane: l, kind: Math.random() < 0.5 ? 'low' : 'high', color });
      free = (l + 1) % 3;
    }
    for (let i = 0; i < 5; i++) coins.current.push({ z: z + 7 + i * 2.6, lane: free, got: false });
  };

  const start = () => {
    if (phaseRef.current !== 'ready') return;
    reset();
    setPhaseBoth('playing');
  };

  const finish = () => {
    setIsNew(score.current > bestRef.current);
    flash.current = 0;
    setPhaseBoth('over');
    submitScore(GAME_ID, score.current).then((b) => { bestRef.current = b; setBest(b); });
    render();
  };

  const crash = () => {
    flash.current = 1;
    dyingT.current = 0.55;
    setPhaseBoth('dying');
  };

  const moveLane = (d: number) => { lane.current = Math.max(0, Math.min(2, lane.current + d)); };
  const jump = () => {
    if (jh.current > 0.01) return;
    slideT.current = 0;
    jv.current = JUMP_V;
    jh.current = 0.02;
  };
  const slide = () => {
    if (jh.current > 0.01) { jv.current = Math.min(jv.current, 0) - 30; return; }
    slideT.current = SLIDE_TIME;
  };

  const tick = (dt: number) => {
    time.current += dt;
    flash.current = Math.max(0, flash.current - dt * 3);
    const ph = phaseRef.current;

    if (ph === 'ready') {
      dist.current += 11 * dt;
      cycle.current += dt * 12;
      return render();
    }
    if (ph === 'dying') {
      dyingT.current -= dt;
      if (dyingT.current <= 0) finish();
      return render();
    }

    const v = Math.min(36, 17 + dist.current * 0.0035);
    dist.current += v * dt;
    cycle.current += dt * (8 + v * 0.35);
    laneF.current += (lane.current - laneF.current) * Math.min(1, dt * 14);
    if (slideT.current > 0) slideT.current -= dt;

    if (jh.current > 0) {
      jh.current += jv.current * dt;
      jv.current -= GRAVITY * dt;
      if (jh.current <= 0) { jh.current = 0; jv.current = 0; }
    }

    spawnZ.current -= v * dt;
    while (spawnZ.current <= Z_MAX) {
      addRow(spawnZ.current);
      spawnZ.current += Math.max(26, v * (0.9 + Math.random() * 0.5));
    }

    const myLane = Math.round(laneF.current);
    for (const o of obstacles.current) {
      o.z -= v * dt;
      if (o.lane !== myLane || o.z > 0.9 || o.z < -0.4) continue;
      if (o.kind === 'wall') return crash();
      if (o.kind === 'low' && jh.current < 1.1) return crash();
      if (o.kind === 'high' && slideT.current <= 0) return crash();
    }
    for (const c of coins.current) {
      c.z -= v * dt;
      if (!c.got && c.lane === myLane && c.z < 0.9 && c.z > -0.7 && jh.current < 1.6) { c.got = true; coinCount.current += 1; }
    }
    obstacles.current = obstacles.current.filter((o) => o.z > -4);
    coins.current = coins.current.filter((c) => c.z > -4 && !c.got);

    score.current = Math.floor(dist.current / 4) + coinCount.current * 5;
    render();
  };

  useGameLoop(tick, phase !== 'over');

  const onGrant = (e: GestureResponderEvent) => {
    swipeStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    start();
  };
  const onMove = (e: GestureResponderEvent) => {
    if (phaseRef.current !== 'playing') return;
    const dx = e.nativeEvent.pageX - swipeStart.current.x;
    const dy = e.nativeEvent.pageY - swipeStart.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) jump();
    else slide();
    swipeStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  };

  useEffect(() => {
    if (RNPlatform.OS !== 'web') return;
    const dn = (e: KeyboardEvent) => {
      if (phaseRef.current === 'ready') { start(); return; }
      if (phaseRef.current !== 'playing') return;
      if (e.key === 'ArrowLeft' || e.key === 'a') moveLane(-1);
      else if (e.key === 'ArrowRight' || e.key === 'd') moveLane(1);
      else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') jump();
      else if (e.key === 'ArrowDown' || e.key === 's') slide();
    };
    window.addEventListener('keydown', dn);
    return () => window.removeEventListener('keydown', dn);
  }, []);

  const restart = () => { reset(); setPhaseBoth('ready'); setIsNew(false); };

  // ---- rendering helpers ----
  const g0 = Math.floor((dist.current - 3.6) / BAND);
  const bands: React.ReactNode[] = [];
  for (let k = 0; k < Math.ceil((Z_MAX + 8) / BAND); k++) {
    const idx = g0 + k;
    const zn = Math.max(idx * BAND - dist.current, -3.6);
    const zf = idx * BAND - dist.current + BAND;
    if (zf < 0 || zn > Z_MAX) continue;
    const sN = sOf(zn);
    const sF = sOf(Math.min(zf, Z_MAX));
    const yN = yOf(sN);
    const yF = yOf(sF);
    const even = idx % 2 === 0;
    bands.push(
      <View key={`g${idx}`} pointerEvents="none" style={{ position: 'absolute', left: 0, width: W, top: yF, height: yN - yF + 1, backgroundColor: even ? '#3f9c55' : '#47a95c' }} />,
      <Trapezoid key={`r${idx}`} left={cx - roadHalf * sN} top={yF} topW={2 * roadHalf * sF} botW={2 * roadHalf * sN} height={yN - yF + 1} color={even ? '#4b4560' : '#554e6b'} />,
    );
    // rumble strips on the road edge
    {
      const edgeW = 9;
      [-1, 1].forEach((side) => {
        bands.push(
          <View
            key={`c${idx}${side}`}
            pointerEvents="none"
            style={{ position: 'absolute', left: cx + side * roadHalf * (sN + sF) / 2 - (side > 0 ? 0 : edgeW * (sN + sF) / 2) , width: edgeW * (sN + sF) / 2, top: yF, height: yN - yF + 1, backgroundColor: even ? '#fff' : theme.red }}
          />,
        );
      });
    }
  }

  const laneLine = (xFrac: number, key: string) => {
    const x0 = cx;
    const y0 = horizonY;
    const x1 = cx + xFrac * laneW * (H - horizonY) / (bottomY - horizonY);
    const y1 = H;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(x1 - x0, y1 - y0);
    return (
      <View
        key={key}
        pointerEvents="none"
        style={{ position: 'absolute', left: (x0 + x1) / 2 - 2, top: (y0 + y1) / 2 - len / 2, width: 4, height: len, backgroundColor: 'rgba(255,255,255,0.55)', transform: [{ rotate: `${-ang}rad` }] }}
      />
    );
  };

  const renderObstacle = (o: Obstacle, i: number) => {
    const s = sOf(o.z);
    if (o.z > Z_MAX) return null;
    const x = cx + (o.lane - 1) * laneW * s;
    const y = yOf(s);
    const bw = Math.max(2, 3 * s);
    if (o.kind === 'wall') {
      const w = laneW * 0.8 * s;
      const h = 96 * s;
      return (
        <View key={`o${i}`} pointerEvents="none" style={{ position: 'absolute', left: x - w / 2, top: y - h, width: w, height: h, backgroundColor: o.color, borderWidth: bw, borderColor: theme.ink, borderRadius: 4 * s, overflow: 'hidden' }}>
          {[0.2, 0.4, 0.6, 0.8].map((f) => (
            <View key={f} style={{ position: 'absolute', left: 0, right: 0, top: h * f, height: Math.max(1, 3 * s), backgroundColor: 'rgba(0,0,0,0.25)' }} />
          ))}
          <View style={{ position: 'absolute', left: 4 * s, top: 4 * s, width: w * 0.3, height: 6 * s, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 3 * s }} />
        </View>
      );
    }
    if (o.kind === 'low') {
      const w = laneW * 0.86 * s;
      const h = 30 * s;
      return (
        <View key={`o${i}`} pointerEvents="none" style={{ position: 'absolute', left: x - w / 2, top: y - h, width: w, height: h }}>
          <View style={{ position: 'absolute', left: w * 0.08, bottom: 0, width: 5 * s, height: h, backgroundColor: '#ddd', borderWidth: bw / 2, borderColor: theme.ink }} />
          <View style={{ position: 'absolute', right: w * 0.08, bottom: 0, width: 5 * s, height: h, backgroundColor: '#ddd', borderWidth: bw / 2, borderColor: theme.ink }} />
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: h * 0.5, backgroundColor: '#fff', borderWidth: bw, borderColor: theme.ink, borderRadius: 3 * s, overflow: 'hidden', flexDirection: 'row' }}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <View key={n} style={{ flex: 1, backgroundColor: n % 2 ? '#fff' : theme.red }} />
            ))}
          </View>
        </View>
      );
    }
    const w = laneW * 0.92 * s;
    const top = y - 92 * s;
    return (
      <View key={`o${i}`} pointerEvents="none" style={{ position: 'absolute', left: x - w / 2, top, width: w, height: 92 * s }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7 * s, backgroundColor: '#8d8aa0', borderWidth: bw / 2, borderColor: theme.ink }} />
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7 * s, backgroundColor: '#8d8aa0', borderWidth: bw / 2, borderColor: theme.ink }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 30 * s, backgroundColor: '#ffcf33', borderWidth: bw, borderColor: theme.ink, borderRadius: 3 * s, overflow: 'hidden', flexDirection: 'row' }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
            <View key={n} style={{ flex: 1, backgroundColor: n % 2 ? '#ffcf33' : theme.ink, transform: [{ skewX: '-30deg' }] }} />
          ))}
        </View>
      </View>
    );
  };

  const renderCoin = (c: Coin, i: number) => {
    if (c.z > Z_MAX) return null;
    const s = sOf(c.z);
    const d = 22 * s;
    const bob = Math.sin(time.current * 6 + i) * 2 * s;
    return (
      <View key={`k${i}`} pointerEvents="none" style={{ position: 'absolute', left: cx + (c.lane - 1) * laneW * s - d / 2, top: yOf(s) - 30 * s - d / 2 + bob, width: d, height: d, borderRadius: d / 2, backgroundColor: theme.yellow, borderWidth: Math.max(1.5, 2.5 * s), borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: d * 0.36, height: d * 0.5, borderRadius: d * 0.12, backgroundColor: '#f2a900' }} />
      </View>
    );
  };

  const near = obstacles.current.filter((o) => o.z <= 0).sort((a, b) => b.z - a.z);
  const far = obstacles.current.filter((o) => o.z > 0).sort((a, b) => b.z - a.z);
  const farCoins = coins.current.filter((c) => c.z > 0).sort((a, b) => b.z - a.z);
  const nearCoins = coins.current.filter((c) => c.z <= 0);

  const px = cx + (laneF.current - 1) * laneW;
  const runnerH = 82;
  const lean = Math.max(-1, Math.min(1, lane.current - laneF.current));
  const airPx = jh.current * PX_PER_UNIT;
  const shake = phase === 'dying' ? Math.sin(time.current * 80) * 6 : 0;

  return (
    <View
      style={styles.root}
      onStartShouldSetResponder={() => true}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
    >
      <View style={[StyleSheet.absoluteFill, { transform: [{ translateX: shake }] }]}>
        <LinearGradient colors={['#4a3a9c', '#ff7e6b', '#ffd98a']} locations={[0, 0.6, 1]} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: horizonY + 4 }} />
        <View style={{ position: 'absolute', left: cx + W * 0.12, top: horizonY - 58, width: 96, height: 96, borderRadius: 48, backgroundColor: '#fff2b0', opacity: 0.95 }} />
        {skyline.map((b, i) => (
          <View key={i} style={{ position: 'absolute', left: b.x, top: horizonY - b.h + 2, width: b.w, height: b.h, backgroundColor: i % 3 ? '#4b3a7d' : '#5a4890' }}>
            {b.h > 50 && [0, 1].map((r) => <View key={r} style={{ position: 'absolute', left: 5, right: 5, top: 8 + r * 14, height: 4, backgroundColor: 'rgba(255,220,140,0.55)' }} />)}
          </View>
        ))}
        <View style={{ position: 'absolute', left: 0, right: 0, top: horizonY, bottom: 0, backgroundColor: '#3f9c55' }} />
        {bands}
        {laneLine(-0.5, 'l1')}
        {laneLine(0.5, 'l2')}

        {farCoins.map(renderCoin)}
        {far.map(renderObstacle)}

        {/* shadow + runner */}
        <View style={{ position: 'absolute', left: px - 24, top: bottomY - 6, width: 48 - Math.min(18, airPx * 0.18), height: 12, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.3)', marginLeft: Math.min(9, airPx * 0.09) }} />
        <View style={{ position: 'absolute', left: px - runnerH * 0.28, top: bottomY - runnerH - airPx }}>
          <Runner size={runnerH} cycle={cycle.current} sliding={slideT.current > 0} jumping={jh.current > 0.05} lean={lean} />
        </View>

        {nearCoins.map(renderCoin)}
        {near.map(renderObstacle)}
      </View>

      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash.current * 0.7 }]} pointerEvents="none" />

      {phase !== 'over' && phase !== 'ready' && (
        <>
          <View style={styles.scoreWrap} pointerEvents="none">
            <StrokedText size={52} width={3} drop={3}>{score.current}</StrokedText>
          </View>
          <View style={styles.coinChip} pointerEvents="none">
            <View style={styles.coinDot} />
            <StrokedText size={20} width={2}>{coinCount.current}</StrokedText>
          </View>
        </>
      )}

      <Pressable style={styles.exit} onPress={onExit} hitSlop={12} accessibilityLabel="Back to home screen">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>

      {phase === 'ready' && (
        <View style={styles.readyWrap} pointerEvents="none">
          <StrokedText size={46} color={theme.yellow} width={3} drop={3}>Lane Dash!</StrokedText>
          <StrokedText size={15} font={fonts.pixelBold} width={2}>SWIPE ◄ ► TO DODGE</StrokedText>
          <StrokedText size={15} font={fonts.pixelBold} width={2}>▲ JUMP   ▼ SLIDE</StrokedText>
          {best > 0 && <StrokedText size={13} font={fonts.pixelBold} color={theme.yellow} width={2}>{`BEST ${best}`}</StrokedText>}
        </View>
      )}

      {phase === 'over' && (
        <ScoreBoard score={score.current} best={best} isNew={isNew} medals={[150, 400, 900]} onPlay={restart} onMenu={onExit} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#3f9c55', overflow: 'hidden' },
  scoreWrap: { position: 'absolute', top: 66, left: 0, right: 0, alignItems: 'center' },
  coinChip: { position: 'absolute', top: 50, right: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,42,63,0.55)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16 },
  coinDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: theme.yellow, borderWidth: 2.5, borderColor: theme.ink },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  readyWrap: { position: 'absolute', left: 0, right: 0, top: '12%', alignItems: 'center', gap: 14 },
});

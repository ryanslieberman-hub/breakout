import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Platform as RNPlatform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { getHighScore, submitScore } from '../../core/scores';
import type { GameProps } from '../../core/types';
import { useGameLoop } from '../../core/useGameLoop';
import ScoreBoard from '../../ui/ScoreBoard';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import { Cloud } from '../flappy/Scenery';
import { skyAt } from '../hop/Hop';

const GAME_ID = 'stack';
const BLOCK_H = 34;
const PERFECT = 5;

type Phase = 'ready' | 'playing' | 'dying' | 'over';
interface Block { x: number; w: number; y: number; hue: number }
interface Piece extends Block { vy: number; vr: number; rot: number }

const color = (hue: number, l = 58) => `hsl(${hue % 360}, 78%, ${l}%)`;

function BlockView({ b, camTop, rot = 0, opacity = 1 }: { b: Block; camTop: number; rot?: number; opacity?: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left: b.x, top: b.y - camTop, width: b.w, height: BLOCK_H, opacity,
        backgroundColor: color(b.hue), borderWidth: 3, borderColor: theme.ink, borderRadius: 5, overflow: 'hidden',
        transform: [{ rotate: `${rot}deg` }],
      }}
    >
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 9, backgroundColor: color(b.hue, 72) }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 7, backgroundColor: color(b.hue, 44) }} />
      <View style={{ position: 'absolute', left: 6, top: 3, width: Math.min(22, b.w * 0.3), height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.7)' }} />
    </View>
  );
}

export default function TowerStack({ onExit }: GameProps) {
  const { width: W, height: H } = useWindowDimensions();
  const baseY = H * 0.78;

  const [phase, setPhase] = useState<Phase>('ready');
  const [best, setBest] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const [, render] = useReducer((n: number) => n + 1, 0);

  const phaseRef = useRef<Phase>('ready');
  const bestRef = useRef(0);
  const blocks = useRef<Block[]>([]);
  const mover = useRef<Block & { dir: number }>({ x: 0, w: 0, y: 0, hue: 0, dir: 1 });
  const pieces = useRef<Piece[]>([]);
  const camTop = useRef(0);
  const score = useRef(0);
  const combo = useRef(0);
  const popT = useRef(0);
  const popText = useRef('');
  const time = useRef(0);
  const dyingT = useRef(0);

  useEffect(() => {
    getHighScore(GAME_ID).then((b) => { bestRef.current = b; setBest(b); });
  }, []);

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const spawnMover = (w: number, y: number, hue: number) => {
    const fromLeft = blocks.current.length % 2 === 0;
    mover.current = { x: fromLeft ? 0 : W - w, w, y, hue, dir: fromLeft ? 1 : -1 };
  };

  const reset = useCallback(() => {
    const w = Math.min(W * 0.56, 240);
    blocks.current = [{ x: (W - w) / 2, w, y: baseY, hue: 200 }];
    pieces.current = [];
    score.current = 0;
    combo.current = 0;
    popT.current = 0;
    camTop.current = baseY - H * 0.62;
    spawnMover(w, baseY - BLOCK_H, 214);
    render();
  }, [W, H]);

  useEffect(reset, [reset]);

  const finish = () => {
    setIsNew(score.current > bestRef.current);
    setPhaseBoth('over');
    submitScore(GAME_ID, score.current).then((b) => { bestRef.current = b; setBest(b); });
    render();
  };

  const drop = () => {
    const ph = phaseRef.current;
    if (ph === 'ready') { setPhaseBoth('playing'); return; }
    if (ph !== 'playing') return;
    const top = blocks.current[blocks.current.length - 1];
    const m = mover.current;
    const left = Math.max(m.x, top.x);
    const right = Math.min(m.x + m.w, top.x + top.w);
    const overlap = right - left;

    if (overlap <= 0) {
      pieces.current.push({ x: m.x, w: m.w, y: m.y, hue: m.hue, vy: 0, vr: m.dir * 40, rot: 0 });
      dyingT.current = 0.8;
      setPhaseBoth('dying');
      return;
    }

    let nx = left;
    let nw = overlap;
    if (Math.abs(m.x - top.x) <= PERFECT) {
      nx = top.x;
      nw = top.w;
      combo.current += 1;
      popText.current = combo.current > 1 ? `PERFECT x${combo.current}` : 'PERFECT!';
      popT.current = 0.9;
    } else {
      combo.current = 0;
      const cutW = m.w - overlap;
      const cutX = m.x < top.x ? m.x : right;
      pieces.current.push({ x: cutX, w: cutW, y: m.y, hue: m.hue, vy: 0, vr: (m.x < top.x ? -1 : 1) * 30, rot: 0 });
    }
    blocks.current.push({ x: nx, w: nw, y: m.y, hue: m.hue });
    score.current += 1;
    spawnMover(nw, m.y - BLOCK_H, m.hue + 14);
  };

  const tick = (dt: number) => {
    time.current += dt;
    if (popT.current > 0) popT.current -= dt;

    const speedBase = 190 + Math.min(300, score.current * 9);
    if (phaseRef.current === 'ready' || phaseRef.current === 'playing') {
      const m = mover.current;
      m.x += m.dir * (phaseRef.current === 'ready' ? 140 : speedBase) * dt;
      const maxX = W - m.w;
      if (m.x < 0) { m.x = 0; m.dir = 1; }
      if (m.x > maxX) { m.x = maxX; m.dir = -1; }
    }

    for (const p of pieces.current) { p.vy += 1700 * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
    pieces.current = pieces.current.filter((p) => p.y - camTop.current < H + 100);

    if (phaseRef.current === 'dying') {
      dyingT.current -= dt;
      if (dyingT.current <= 0) return finish();
    }

    const top = blocks.current[blocks.current.length - 1];
    const targetCam = Math.min(baseY - H * 0.62, top.y - H * 0.4);
    camTop.current += (targetCam - camTop.current) * Math.min(1, dt * 5);
    render();
  };

  useGameLoop(tick, phase !== 'over');

  useEffect(() => {
    if (RNPlatform.OS !== 'web') return;
    const dn = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') drop(); };
    window.addEventListener('keydown', dn);
    return () => window.removeEventListener('keydown', dn);
  }, []);

  const restart = () => { reset(); setPhaseBoth('ready'); setIsNew(false); };

  const sky = skyAt(score.current * 5);
  const m = mover.current;

  return (
    <View style={styles.root} onStartShouldSetResponder={() => true} onResponderGrant={drop}>
      <LinearGradient colors={[sky.top, sky.bot]} style={StyleSheet.absoluteFill} />
      {[0, 1, 2].map((i) => {
        const span = H + 260;
        const y = ((((i * 260 + 60 - camTop.current * 0.25) % span) + span) % span) - 130;
        return <View key={i} style={{ opacity: 1 - sky.night * 0.85 }}><Cloud x={(i * 130 + 20) % (W - 80)} y={y} scale={0.8 + (i % 2) * 0.3} /></View>;
      })}

      <View style={{ position: 'absolute', left: 0, right: 0, top: baseY + BLOCK_H - camTop.current - 2, height: H, backgroundColor: '#2f6f3e', borderTopWidth: 4, borderTopColor: theme.ink }}>
        <View style={{ height: 14, backgroundColor: theme.grass }} />
      </View>

      {blocks.current.map((b, i) => <BlockView key={i} b={b} camTop={camTop.current} />)}
      {phase !== 'over' && <BlockView b={m} camTop={camTop.current} />}
      {pieces.current.map((p, i) => <BlockView key={`p${i}`} b={p} camTop={camTop.current} rot={p.rot} />)}

      {phase !== 'over' && (
        <View style={styles.scoreWrap} pointerEvents="none">
          <StrokedText size={56} width={3} drop={3}>{score.current}</StrokedText>
        </View>
      )}

      {popT.current > 0 && (
        <View style={[styles.pop, { opacity: Math.min(1, popT.current * 2.2), transform: [{ translateY: -(0.9 - popT.current) * 40 }] }]} pointerEvents="none">
          <StrokedText size={26} color={theme.yellow} width={2.5} drop={2}>{popText.current}</StrokedText>
        </View>
      )}

      <Pressable style={styles.exit} onPress={onExit} hitSlop={12} accessibilityLabel="Back to home screen">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>

      {phase === 'ready' && (
        <View style={styles.readyWrap} pointerEvents="none">
          <StrokedText size={44} color={theme.yellow} width={3} drop={3}>Tower Stack!</StrokedText>
          <StrokedText size={15} font={fonts.pixelBold} width={2}>TAP TO DROP THE BLOCK</StrokedText>
          {best > 0 && <StrokedText size={13} font={fonts.pixelBold} color={theme.yellow} width={2}>{`BEST ${best}`}</StrokedText>}
        </View>
      )}

      {phase === 'over' && (
        <ScoreBoard score={score.current} best={best} isNew={isNew} medals={[10, 25, 50]} onPlay={restart} onMenu={onExit} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#2ba7d9', overflow: 'hidden' },
  scoreWrap: { position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center' },
  pop: { position: 'absolute', top: 150, left: 0, right: 0, alignItems: 'center' },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  readyWrap: { position: 'absolute', left: 0, right: 0, top: '14%', alignItems: 'center', gap: 14 },
});

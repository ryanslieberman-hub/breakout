import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { getHighScore, submitScore } from '../../core/scores';
import type { GameProps } from '../../core/types';
import { useGameLoop } from '../../core/useGameLoop';
import ScoreBoard from '../../ui/ScoreBoard';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import Bird from './Bird';
import { Backdrop, CAP_H, Ground, Pipe } from './Scenery';

const GAME_ID = 'flappy';
const GRAVITY = 1500;
const FLAP_VELOCITY = -430;
const PIPE_SPEED = 160;
const PIPE_WIDTH = 70;
const PIPE_SPACING = 235;
const GAP = 178;
const GROUND = 92;
const BIRD_SIZE = 38;
const BIRD_X_RATIO = 0.28;

type Phase = 'ready' | 'playing' | 'dying' | 'over';
interface Pipe { x: number; gapY: number; passed: boolean }

export default function Flappy({ onExit }: GameProps) {
  const { width: W, height: H } = useWindowDimensions();
  const playH = H - GROUND;
  const birdX = W * BIRD_X_RATIO;
  const r = BIRD_SIZE * 0.36;
  const readyY = playH * 0.58;

  const [phase, setPhase] = useState<Phase>('ready');
  const [best, setBest] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const [, render] = useReducer((n: number) => n + 1, 0);

  const birdY = useRef(readyY);
  const vel = useRef(0);
  const pipes = useRef<Pipe[]>([]);
  const score = useRef(0);
  const phaseRef = useRef<Phase>('ready');
  const bestRef = useRef(0);
  const time = useRef(0);
  const scroll = useRef(0);
  const flapT = useRef(0);
  const flash = useRef(0);
  const shake = useRef(0);

  useEffect(() => {
    getHighScore(GAME_ID).then((b) => { bestRef.current = b; setBest(b); });
  }, []);

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const randomGapY = () => 100 + Math.random() * (playH - GAP - 200) + GAP / 2;

  const reset = useCallback(() => {
    birdY.current = readyY;
    vel.current = 0;
    score.current = 0;
    flash.current = 0;
    shake.current = 0;
    pipes.current = [0, 1, 2].map((i) => ({ x: W + 140 + i * PIPE_SPACING, gapY: randomGapY(), passed: false }));
    render();
  }, [W, playH, readyY]);

  useEffect(reset, [reset]);

  const finish = () => {
    flash.current = 0;
    shake.current = 0;
    const prev = bestRef.current;
    setIsNew(score.current > prev);
    setPhaseBoth('over');
    submitScore(GAME_ID, score.current).then((b) => { bestRef.current = b; setBest(b); });
    render();
  };

  const die = () => {
    flash.current = 1;
    shake.current = 1;
    setPhaseBoth('dying');
  };

  const tick = (dt: number) => {
    time.current += dt;
    const ph = phaseRef.current;
    if (flapT.current > 0) flapT.current -= dt;
    flash.current = Math.max(0, flash.current - dt * 4);
    shake.current = Math.max(0, shake.current - dt * 2.5);

    if (ph === 'ready') {
      scroll.current += PIPE_SPEED * dt;
      birdY.current = readyY + Math.sin(time.current * 5) * 9;
      return render();
    }

    vel.current += GRAVITY * dt;
    birdY.current += vel.current * dt;

    if (ph === 'dying') {
      if (birdY.current + r >= playH) {
        birdY.current = playH - r;
        return finish();
      }
      return render();
    }

    scroll.current += PIPE_SPEED * dt;
    for (const p of pipes.current) p.x -= PIPE_SPEED * dt;
    const first = pipes.current[0];
    if (first && first.x < -PIPE_WIDTH - 10) {
      pipes.current.shift();
      const last = pipes.current[pipes.current.length - 1];
      pipes.current.push({ x: last.x + PIPE_SPACING, gapY: randomGapY(), passed: false });
    }

    if (birdY.current + r > playH) {
      birdY.current = playH - r;
      flash.current = 1;
      shake.current = 1;
      return finish();
    }
    if (birdY.current - r < 0) { birdY.current = r; vel.current = 0; }

    for (const p of pipes.current) {
      if (!p.passed && p.x + PIPE_WIDTH < birdX - r) { p.passed = true; score.current += 1; }
      const overlapX = birdX + r > p.x - 5 && birdX - r < p.x + PIPE_WIDTH + 5;
      const inGap = birdY.current - r > p.gapY - GAP / 2 && birdY.current + r < p.gapY + GAP / 2;
      if (overlapX && !inGap) return die();
    }
    render();
  };

  useGameLoop(tick, phase !== 'over');

  const onTap = () => {
    const ph = phaseRef.current;
    if (ph === 'over' || ph === 'dying') return;
    if (ph === 'ready') setPhaseBoth('playing');
    vel.current = FLAP_VELOCITY;
    flapT.current = 0.16;
  };

  const restart = () => { reset(); setPhaseBoth('ready'); setIsNew(false); };

  const tilt = phase === 'dying' || phase === 'over' ? 80 : Math.max(-28, Math.min(80, vel.current / 7));
  const wing = flapT.current > 0 ? -42 : 18 + Math.sin(time.current * 22) * (phase === 'playing' ? 6 : 14);
  const groundTop = playH;
  const sx = Math.sin(time.current * 70) * shake.current * 7;
  const pulse = 1 + Math.sin(time.current * 6) * 0.06;

  return (
    <View style={styles.root} onStartShouldSetResponder={() => true} onResponderGrant={onTap}>
      <View style={[StyleSheet.absoluteFill, { transform: [{ translateX: sx }] }]}>
        <Backdrop width={W} groundTop={groundTop} offset={scroll.current} time={time.current} />

        {pipes.current.map((p, i) => (
          <View key={i} style={{ position: 'absolute', left: p.x, top: 0 }}>
            <Pipe width={PIPE_WIDTH} height={p.gapY - GAP / 2} capAtBottom />
            <View style={{ position: 'absolute', top: p.gapY + GAP / 2 }}>
              <Pipe width={PIPE_WIDTH} height={playH - (p.gapY + GAP / 2)} capAtBottom={false} />
            </View>
          </View>
        ))}

        <View style={{ position: 'absolute', left: birdX - BIRD_SIZE / 2, top: birdY.current - (BIRD_SIZE * 0.78) / 2, transform: [{ rotate: `${tilt}deg` }] }}>
          <Bird size={BIRD_SIZE} wing={wing} />
        </View>

        <Ground width={W} height={GROUND} offset={scroll.current} />
      </View>

      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash.current * 0.85 }]} pointerEvents="none" />

      {phase !== 'over' && phase !== 'ready' && (
        <View style={styles.scoreWrap} pointerEvents="none">
          <StrokedText size={60} width={3} drop={3}>{score.current}</StrokedText>
        </View>
      )}

      <Pressable style={styles.exit} onPress={onExit} hitSlop={12} accessibilityLabel="Back to home screen">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>

      {phase === 'ready' && (
        <View style={styles.readyWrap} pointerEvents="none">
          <StrokedText size={46} color={theme.yellow} width={3} drop={3}>Get Ready!</StrokedText>
          <View style={[styles.tapRing, { transform: [{ scale: pulse }] }]}>
            <View style={styles.tapDot} />
          </View>
          <StrokedText size={18} font={fonts.pixelBold} width={2}>TAP TO FLAP</StrokedText>
          {best > 0 && <StrokedText size={13} font={fonts.pixelBold} color={theme.yellow} width={2}>{`BEST ${best}`}</StrokedText>}
        </View>
      )}

      {phase === 'over' && (
        <ScoreBoard score={score.current} best={best} isNew={isNew} onPlay={restart} onMenu={onExit} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.sky, overflow: 'hidden' },
  scoreWrap: { position: 'absolute', top: 76, left: 0, right: 0, alignItems: 'center' },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  readyWrap: { position: 'absolute', left: 0, right: 0, top: '11%', alignItems: 'center', gap: 18 },
  tapRing: { width: 70, height: 70, borderRadius: 35, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  tapDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 3, borderColor: theme.ink },
  readyBest: { fontFamily: fonts.pixelBold, fontSize: 13, color: theme.ink, letterSpacing: 1 },
});

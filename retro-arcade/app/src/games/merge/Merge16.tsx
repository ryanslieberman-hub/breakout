import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { getHighScore, submitScore } from '../../core/scores';
import type { GameProps } from '../../core/types';
import ScoreBoard from '../../ui/ScoreBoard';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';

const GAME_ID = 'merge';
const N = 4;
const GAP = 8;
const SLIDE_MS = 110;
const useNative = Platform.OS !== 'web';

type Dir = 'left' | 'right' | 'up' | 'down';

interface Tile {
  id: number;
  value: number;
  r: number;
  c: number;
  x: Animated.Value;
  y: Animated.Value;
  scale: Animated.Value;
  gone?: boolean;
  merged?: boolean;
}

const TILE: Record<number, { bg: string; fg: string }> = {
  2: { bg: '#fff1c1', fg: theme.ink },
  4: { bg: '#ffe08a', fg: theme.ink },
  8: { bg: '#ffb74d', fg: theme.ink },
  16: { bg: '#ff8a50', fg: '#fff' },
  32: { bg: '#ff6b6b', fg: '#fff' },
  64: { bg: '#e8402e', fg: '#fff' },
  128: { bg: '#c06bd6', fg: '#fff' },
  256: { bg: '#8b5cf0', fg: '#fff' },
  512: { bg: '#4a7fe8', fg: '#fff' },
  1024: { bg: '#2bb5a0', fg: '#fff' },
  2048: { bg: '#ffd23f', fg: theme.ink },
};
const tileStyle = (v: number) => TILE[v] ?? { bg: theme.ink, fg: '#fff' };

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <StrokedText size={22} width={2}>{value}</StrokedText>
    </View>
  );
}

export default function Merge16({ onExit }: GameProps) {
  const { width: W } = useWindowDimensions();
  const boardSize = Math.min(W - 32, 380);
  const cell = (boardSize - GAP * (N + 1)) / N;
  const pos = (i: number) => GAP + i * (cell + GAP);

  const [tiles, setTiles] = useState<Tile[]>([]);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [over, setOver] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const tilesRef = useRef<Tile[]>([]);
  const scoreRef = useRef(0);
  const bestRef = useRef(0);
  const nextId = useRef(1);
  const busy = useRef(false);
  const overRef = useRef(false);
  const touchStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    getHighScore(GAME_ID).then((b) => { bestRef.current = b; setBest(b); });
  }, []);

  const makeTile = useCallback((value: number, r: number, c: number, pop: boolean): Tile => ({
    id: nextId.current++, value, r, c,
    x: new Animated.Value(pos(c)),
    y: new Animated.Value(pos(r)),
    scale: new Animated.Value(pop ? 0 : 1),
  }), [cell]);

  const popIn = (t: Tile) => {
    Animated.spring(t.scale, { toValue: 1, friction: 6, tension: 160, useNativeDriver: useNative }).start();
  };

  const spawn = useCallback((list: Tile[]): Tile[] => {
    const free: [number, number][] = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!list.some((t) => !t.gone && t.r === r && t.c === c)) free.push([r, c]);
    if (!free.length) return list;
    const [r, c] = free[Math.floor(Math.random() * free.length)];
    const t = makeTile(Math.random() < 0.9 ? 2 : 4, r, c, true);
    popIn(t);
    return [...list, t];
  }, [makeTile]);

  const commit = (list: Tile[]) => { tilesRef.current = list; setTiles(list); };

  const newGame = useCallback(() => {
    scoreRef.current = 0;
    overRef.current = false;
    busy.current = false;
    setScore(0);
    setOver(false);
    setIsNew(false);
    commit(spawn(spawn([])));
  }, [spawn]);

  useEffect(() => { newGame(); }, [newGame]);

  const canMove = (list: Tile[]) => {
    const live = list.filter((t) => !t.gone);
    if (live.length < N * N) return true;
    return live.some((t) => live.some((o) => o.value === t.value && Math.abs(o.r - t.r) + Math.abs(o.c - t.c) === 1));
  };

  const move = (dir: Dir) => {
    if (busy.current || overRef.current) return;
    const live = tilesRef.current.filter((t) => !t.gone);
    const horizontal = dir === 'left' || dir === 'right';
    const reverse = dir === 'right' || dir === 'down';
    let moved = false;
    let gained = 0;
    const consumed: Tile[] = [];

    for (let line = 0; line < N; line++) {
      const inLine = live
        .filter((t) => (horizontal ? t.r : t.c) === line)
        .sort((a, b) => (horizontal ? a.c - b.c : a.r - b.r) * (reverse ? -1 : 1));
      let slot = 0;
      let prev: Tile | null = null;
      for (const t of inLine) {
        if (prev && prev.value === t.value && !prev.merged) {
          const target = prev;
          target.merged = true;
          t.r = target.r;
          t.c = target.c;
          target.value *= 2;
          gained += target.value;
          consumed.push(t);
          moved = true;
        } else {
          const idx = reverse ? N - 1 - slot : slot;
          const nr = horizontal ? line : idx;
          const nc = horizontal ? idx : line;
          if (nr !== t.r || nc !== t.c) moved = true;
          t.r = nr;
          t.c = nc;
          slot += 1;
          prev = t;
        }
      }
    }
    if (!moved) return;

    busy.current = true;
    const anims = live.map((t) =>
      Animated.parallel([
        Animated.timing(t.x, { toValue: pos(t.c), duration: SLIDE_MS, useNativeDriver: useNative }),
        Animated.timing(t.y, { toValue: pos(t.r), duration: SLIDE_MS, useNativeDriver: useNative }),
      ]),
    );
    Animated.parallel(anims).start(() => {
      consumed.forEach((t) => { t.gone = true; });
      live.forEach((t) => {
        if (t.merged) {
          t.merged = false;
          t.scale.setValue(1.22);
          Animated.spring(t.scale, { toValue: 1, friction: 5, tension: 200, useNativeDriver: useNative }).start();
        }
      });
      const next = spawn(tilesRef.current.filter((t) => !t.gone));
      commit(next);
      busy.current = false;
      if (!canMove(next)) {
        overRef.current = true;
        setIsNew(scoreRef.current > bestRef.current);
        setOver(true);
        submitScore(GAME_ID, scoreRef.current).then((b) => { bestRef.current = b; setBest(b); });
      }
    });

    scoreRef.current += gained;
    setScore(scoreRef.current);
    if (scoreRef.current > bestRef.current) { bestRef.current = scoreRef.current; setBest(scoreRef.current); }
    setTiles([...tilesRef.current]);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const map: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
    const dn = (e: KeyboardEvent) => { const d = map[e.key]; if (d) { e.preventDefault(); move(d); } };
    window.addEventListener('keydown', dn);
    return () => window.removeEventListener('keydown', dn);
  }, []);

  const onGrant = (e: GestureResponderEvent) => { touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; };
  const onRelease = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.pageX - touchStart.current.x;
    const dy = e.nativeEvent.pageY - touchStart.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
    else move(dy > 0 ? 'down' : 'up');
  };

  const maxTile = Math.max(2, ...tiles.filter((t) => !t.gone).map((t) => t.value));

  return (
    <View style={styles.root} onStartShouldSetResponder={() => true} onResponderGrant={onGrant} onResponderRelease={onRelease}>
      <LinearGradient colors={['#ffd98a', '#f4a85e']} style={StyleSheet.absoluteFill} />

      <Pressable style={styles.exit} onPress={onExit} hitSlop={12} accessibilityLabel="Back to home screen">
        <Text style={styles.exitText}>‹</Text>
      </Pressable>

      <View style={styles.header}>
        <StrokedText size={44} color={theme.yellow} width={3} drop={3}>Merge 16</StrokedText>
        <View style={styles.chips}>
          <Chip label="SCORE" value={score} />
          <Chip label="BEST" value={best} />
        </View>
      </View>

      <View style={[styles.board, { width: boardSize, height: boardSize }]}>
        {Array.from({ length: N * N }, (_, i) => (
          <View key={i} style={{ position: 'absolute', left: pos(i % N), top: pos(Math.floor(i / N)), width: cell, height: cell, borderRadius: 10, backgroundColor: 'rgba(59,42,63,0.22)' }} />
        ))}
        {tiles.filter((t) => !t.gone).map((t) => {
          const s = tileStyle(t.value);
          return (
            <Animated.View
              key={t.id}
              pointerEvents="none"
              style={[styles.tile, { width: cell, height: cell, backgroundColor: s.bg, transform: [{ translateX: t.x }, { translateY: t.y }, { scale: t.scale }] }]}
            >
              <View style={styles.tileShine} />
              <Text style={{ fontFamily: fonts.display, fontSize: t.value >= 1000 ? cell * 0.3 : t.value >= 100 ? cell * 0.38 : cell * 0.48, color: s.fg }}>{t.value}</Text>
            </Animated.View>
          );
        })}
      </View>

      <Text style={styles.hint}>Swipe to slide the tiles. Matching numbers merge.</Text>
      <Text style={styles.goal}>{maxTile >= 2048 ? 'You made 2048!' : `Biggest tile: ${maxTile}`}</Text>

      {over && <ScoreBoard score={score} best={best} isNew={isNew} medals={[1000, 3000, 8000]} onPlay={newGame} onMenu={onExit} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f4a85e', alignItems: 'center', justifyContent: 'center', gap: 18 },
  exit: { position: 'absolute', top: 44, left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  exitText: { color: '#fff', fontSize: 28, lineHeight: 30, fontFamily: fonts.display, marginTop: -3 },
  header: { alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', gap: 10 },
  chip: { minWidth: 92, alignItems: 'center', backgroundColor: theme.ink, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  chipLabel: { fontFamily: fonts.pixelBold, fontSize: 10, color: '#ffb74d', letterSpacing: 1 },
  board: { backgroundColor: '#b57a3e', borderRadius: 16, borderWidth: 4, borderColor: theme.ink, boxShadow: '0px 6px 0px #7d4f24' },
  tile: { position: 'absolute', left: 0, top: 0, borderRadius: 10, borderWidth: 3, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileShine: { position: 'absolute', left: 0, right: 0, top: 0, height: '38%', backgroundColor: 'rgba(255,255,255,0.28)' },
  hint: { fontFamily: fonts.pixelBold, fontSize: 11, color: theme.ink, opacity: 0.8, textAlign: 'center', paddingHorizontal: 24 },
  goal: { fontFamily: fonts.pixelBold, fontSize: 11, color: theme.ink, opacity: 0.6 },
});

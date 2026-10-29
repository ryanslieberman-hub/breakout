import { LilitaOne_400Regular } from '@expo-google-fonts/lilita-one';
import { Silkscreen_400Regular, Silkscreen_700Bold } from '@expo-google-fonts/silkscreen';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getHighScore } from './src/core/scores';
import type { GameModule } from './src/core/types';
import { games } from './src/games';
import { Cloud } from './src/games/flappy/Scenery';
import StrokedText from './src/ui/StrokedText';
import { fonts, theme } from './src/ui/theme';

const COLS = 4;
const SIDE = 22;

function PhoneStatus() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const hh = now.getHours() % 12 || 12;
  const mm = String(now.getMinutes()).padStart(2, '0');
  return (
    <View style={styles.status}>
      <View style={styles.signal}>
        {[5, 8, 11, 14].map((h, i) => (
          <View key={h} style={{ width: 3, height: h, backgroundColor: i < 3 ? '#fff' : 'rgba(255,255,255,0.4)' }} />
        ))}
      </View>
      <Text style={styles.carrier}>4G</Text>
      <View style={{ flex: 1 }} />
      <Text style={styles.clock}>{hh}:{mm}</Text>
      <View style={styles.battery}>
        <View style={styles.batteryFill} />
        <View style={styles.batteryNub} />
      </View>
    </View>
  );
}

function Scenery({ width }: { width: number }) {
  return (
    <>
      <LinearGradient colors={['#2b9fe0', '#7ed0f2', '#d4f3f7']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <Cloud x={-20} y={150} scale={1.1} />
      <Cloud x={width - 110} y={90} scale={0.8} />
      <Cloud x={width * 0.4} y={330} scale={0.7} />
      <View style={[styles.hill, { left: -width * 0.3, width: width * 1.2, height: width * 1.2, bottom: -width * 0.8, backgroundColor: '#8ccf3f' }]} />
      <View style={[styles.hill, { right: -width * 0.45, width: width * 1.3, height: width * 1.3, bottom: -width * 0.88, backgroundColor: theme.grass }]} />
    </>
  );
}

function AppIcon({ game, size, best, onOpen, onSoon }: { game: GameModule; size: number; best: number; onOpen: () => void; onSoon: () => void }) {
  const soon = !game.Component;
  return (
    <Pressable
      onPress={soon ? onSoon : onOpen}
      accessibilityRole="button"
      accessibilityLabel={soon ? `${game.title}, coming soon` : `Play ${game.title}`}
      style={{ width: size + 12, alignItems: 'center' }}
    >
      {({ pressed }) => (
        <View style={{ alignItems: 'center', transform: [{ scale: pressed ? 0.9 : 1 }] }}>
          <View style={{ opacity: soon ? 0.8 : 1 }}>
            <game.Icon size={size} />
          </View>
          {!soon && best > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{best}</Text>
            </View>
          )}
          <Text style={styles.label} numberOfLines={1}>{game.title}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Home({ onPlay }: { onPlay: (g: GameModule) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [bests, setBests] = useState<Record<string, number>>({});
  const [toast, setToast] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Promise.all(games.map(async (g) => [g.id, await getHighScore(g.id)] as const)).then((e) => setBests(Object.fromEntries(e)));
  }, []);

  const soon = (g: GameModule) => {
    setToast(`${g.title} isn't installed yet`);
    toastOpacity.setValue(1);
    Animated.timing(toastOpacity, { toValue: 0, duration: 1800, delay: 600, useNativeDriver: false }).start();
  };

  const iconSize = Math.min(72, (width - SIDE * 2 - 12 * COLS) / COLS);

  return (
    <View style={styles.home}>
      <Scenery width={width} />
      <View style={{ paddingTop: Math.max(insets.top, 10) }}>
        <PhoneStatus />
      </View>

      <View style={styles.logo}>
        <View style={{ transform: [{ rotate: '-4deg' }] }}>
          <StrokedText size={50} color={theme.yellow} width={3.5} drop={4}>Retro</StrokedText>
          <View style={{ marginTop: -6, transform: [{ translateX: 18 }] }}>
            <StrokedText size={50} color="#fff" width={3.5} drop={4}>Arcade</StrokedText>
          </View>
        </View>
        <Text style={styles.tag}>2010s MOBILE CLASSICS</Text>
      </View>

      <View style={styles.grid}>
        {games.map((g) => (
          <AppIcon key={g.id} game={g} size={iconSize} best={bests[g.id] ?? 0} onOpen={() => onPlay(g)} onSoon={() => soon(g)} />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <Animated.View style={[styles.toast, { opacity: toastOpacity }]} pointerEvents="none">
        <Text style={styles.toastText}>{toast}</Text>
      </Animated.View>

      <View style={[styles.dots, { paddingBottom: insets.bottom + 18 }]}>
        <View style={[styles.dot, styles.dotOn]} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>
    </View>
  );
}

export default function App() {
  const [loaded] = useFonts({ LilitaOne_400Regular, Silkscreen_400Regular, Silkscreen_700Bold });
  const [active, setActive] = useState<GameModule | null>(null);
  const exit = useCallback(() => setActive(null), []);

  if (!loaded) return <View style={{ flex: 1, backgroundColor: '#2b9fe0' }} />;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {active?.Component ? <active.Component key={active.id} onExit={exit} /> : <Home onPlay={setActive} />}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1, backgroundColor: '#2b9fe0', overflow: 'hidden' },
  hill: { position: 'absolute', borderRadius: 9999, borderWidth: 3, borderColor: '#3f8a1d' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 22, backgroundColor: 'rgba(0,40,80,0.28)' },
  signal: { flexDirection: 'row', alignItems: 'flex-end', gap: 1.5 },
  carrier: { fontFamily: fonts.pixelBold, fontSize: 10, color: '#fff' },
  clock: { fontFamily: fonts.pixelBold, fontSize: 11, color: '#fff' },
  battery: { width: 22, height: 11, borderWidth: 1.5, borderColor: '#fff', borderRadius: 2, padding: 1, marginLeft: 6 },
  batteryFill: { flex: 1, width: '78%', backgroundColor: '#fff' },
  batteryNub: { position: 'absolute', right: -4, top: 2, width: 2, height: 4, backgroundColor: '#fff' },
  logo: { alignItems: 'center', marginTop: 34, marginBottom: 34 },
  tag: { marginTop: 14, fontFamily: fonts.pixelBold, fontSize: 10, letterSpacing: 1.5, color: theme.ink, opacity: 0.75 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SIDE - 6, rowGap: 22, justifyContent: 'flex-start' },
  label: { marginTop: 6, fontFamily: fonts.pixel, fontSize: 9, color: '#fff', textShadowColor: 'rgba(0,30,60,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  badge: { position: 'absolute', top: -6, right: -2, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: theme.red, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0px 2px 3px rgba(0,0,0,0.4)' },
  badgeText: { fontFamily: fonts.pixelBold, fontSize: 10, color: '#fff' },
  toast: { alignSelf: 'center', marginBottom: 20, backgroundColor: 'rgba(20,20,30,0.82)', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18 },
  toastText: { fontFamily: fonts.pixel, fontSize: 11, color: '#fff' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn: { backgroundColor: '#fff' },
});

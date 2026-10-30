import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function LightBank({ x, y }: { x: number; y: number }) {
  return (
    <View style={{ position: 'absolute', left: x - 90, top: y - 90, width: 180, height: 180 }} pointerEvents="none">
      {[180, 128, 84].map((d, i) => (
        <View key={d} style={{ position: 'absolute', left: 90 - d / 2, top: 90 - d / 2, width: d, height: d, borderRadius: d / 2, backgroundColor: `rgba(255,244,190,${0.05 + i * 0.05})` }} />
      ))}
      <View style={{ position: 'absolute', left: 90 - 3, top: 112, width: 6, height: 110, backgroundColor: '#05091a' }} />
      <View style={{ position: 'absolute', left: 90 - 28, top: 70, width: 56, height: 44, borderRadius: 4, backgroundColor: '#05091a', padding: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
        {Array.from({ length: 9 }, (_, i) => (
          <View key={i} style={{ width: 13, height: 10, borderRadius: 5, backgroundColor: '#fff8d6' }} />
        ))}
      </View>
    </View>
  );
}

/** Night-game backdrop: sky, light towers, a packed crowd, striped turf. */
export default function Stadium({ horizon = 0.42, lights = true }: { horizon?: number; lights?: boolean }) {
  const { width: W, height: H } = useWindowDimensions();
  const hy = H * horizon;
  const crowd = useMemo(() => {
    const r = rng(41);
    const cols = ['#e8402e', '#f5c542', '#5aa9e8', '#ffffff', '#ff8a1f', '#9b5de5', '#2bb5a0'];
    const out: { x: number; y: number; c: string; s: number }[] = [];
    for (let row = 0; row < 6; row++) {
      for (let x = -6; x < W + 6; x += 9 + r() * 4) out.push({ x, y: hy - 26 - row * 12 + r() * 4, c: cols[Math.floor(r() * cols.length)], s: 7 + r() * 3 });
    }
    return out;
  }, [W, hy]);

  return (
    <>
      <LinearGradient colors={['#050a1e', '#10204f', '#2a4f8a']} locations={[0, 0.6, 1]} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: hy }} />
      {lights && <LightBank x={W * 0.14} y={hy * 0.34} />}
      {lights && <LightBank x={W * 0.86} y={hy * 0.34} />}
      <View style={{ position: 'absolute', left: 0, right: 0, top: hy - 90, height: 92, backgroundColor: '#0b1330' }} />
      {crowd.map((c, i) => (
        <View key={i} style={{ position: 'absolute', left: c.x, top: c.y, width: c.s, height: c.s, borderRadius: c.s / 2, backgroundColor: c.c, opacity: 0.55 + (i % 4) * 0.1 }} />
      ))}
      <View style={{ position: 'absolute', left: 0, right: 0, top: hy - 8, height: 12, backgroundColor: '#0b1330' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: hy, bottom: 0, backgroundColor: '#1f6b3d' }} />
      {Array.from({ length: Math.ceil((H - hy) / 46) }, (_, i) => (
        <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: hy + i * 46, height: 23, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      ))}
    </>
  );
}

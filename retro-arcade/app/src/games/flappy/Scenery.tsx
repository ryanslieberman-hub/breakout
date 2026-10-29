import { useMemo } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../ui/theme';

export const CAP_H = 28;
const CAP_OVERHANG = 5;

/** Small deterministic PRNG so the skyline is stable between renders. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function Pipe({ width, height, capAtBottom }: { width: number; height: number; capAtBottom: boolean }) {
  const cap = (
    <View style={{ height: CAP_H, marginHorizontal: -CAP_OVERHANG, borderWidth: 3, borderColor: theme.ink, borderRadius: 4, backgroundColor: theme.grass, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 4, top: 0, bottom: 0, width: 8, backgroundColor: theme.grassLight }} />
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 10, backgroundColor: theme.grassDark }} />
    </View>
  );
  const shaft = (
    <View style={{ flex: 1, marginHorizontal: 1, borderLeftWidth: 3, borderRightWidth: 3, borderColor: theme.ink, backgroundColor: theme.grass, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 3, top: 0, bottom: 0, width: 8, backgroundColor: theme.grassLight }} />
      <View style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: 3, backgroundColor: 'rgba(255,255,255,0.25)' }} />
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 12, backgroundColor: theme.grassDark }} />
    </View>
  );
  return (
    <View style={{ width, height }}>
      {capAtBottom ? <>{shaft}{cap}</> : <>{cap}{shaft}</>}
    </View>
  );
}

export function Cloud({ x, y, scale }: { x: number; y: number; scale: number }) {
  const puff = (l: number, t: number, s: number) => (
    <View style={{ position: 'absolute', left: l, top: t, width: s, height: s, borderRadius: s / 2, backgroundColor: 'rgba(255,255,255,0.92)' }} />
  );
  return (
    <View style={{ position: 'absolute', left: x, top: y, width: 110, height: 50, transform: [{ scale }] }}>
      {puff(0, 18, 30)}{puff(20, 4, 40)}{puff(52, 10, 36)}{puff(76, 20, 28)}
      <View style={{ position: 'absolute', left: 8, top: 30, width: 90, height: 18, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.92)' }} />
    </View>
  );
}

interface Skyline { x: number; w: number; h: number; windows: boolean }

/** Two parallax layers (distant skyline, bushes) that scroll at different rates. */
export function Backdrop({ width, groundTop, offset, time }: { width: number; groundTop: number; offset: number; time: number }) {
  const tile = Math.ceil(width / 40) * 40 + 160;
  const buildings = useMemo<Skyline[]>(() => {
    const r = rng(7);
    const out: Skyline[] = [];
    let x = 0;
    while (x < tile) {
      const w = 34 + Math.floor(r() * 36);
      out.push({ x, w, h: 50 + Math.floor(r() * 90), windows: r() > 0.35 });
      x += w + 2;
    }
    return out;
  }, [tile]);
  const bushes = useMemo(() => {
    const r = rng(21);
    const out: { x: number; s: number }[] = [];
    for (let x = 0; x < tile; x += 22 + r() * 14) out.push({ x, s: 34 + r() * 22 });
    return out;
  }, [tile]);

  const cityOff = (offset * 0.18) % tile;
  const bushOff = (offset * 0.45) % tile;
  const clouds = [0, 1, 2].map((i) => {
    const span = width + 220;
    const x = (((i * 190 - time * (8 + i * 4)) % span) + span) % span - 110;
    return <Cloud key={i} x={x} y={70 + i * 62} scale={0.8 + i * 0.22} />;
  });

  return (
    <>
      <LinearGradient colors={[theme.skyTop, theme.sky, theme.skyHorizon]} locations={[0, 0.55, 1]} style={{ position: 'absolute', inset: 0 }} />
      {clouds}
      {[0, 1].map((copy) =>
        buildings.map((b, i) => (
          <View
            key={`c${copy}-${i}`}
            style={{ position: 'absolute', left: b.x - cityOff + copy * tile, top: groundTop - b.h - 30, width: b.w, height: b.h + 30, backgroundColor: '#a5dcd2', borderTopLeftRadius: 3, borderTopRightRadius: 3, borderWidth: 2, borderBottomWidth: 0, borderColor: '#8bc9c0' }}
          >
            {b.windows && [0, 1, 2].map((row) => (
              <View key={row} style={{ position: 'absolute', left: 6, right: 6, top: 8 + row * 16, height: 6, backgroundColor: 'rgba(255,255,255,0.5)' }} />
            ))}
          </View>
        )),
      )}
      {[0, 1].map((copy) =>
        bushes.map((b, i) => (
          <View
            key={`b${copy}-${i}`}
            style={{ position: 'absolute', left: b.x - bushOff + copy * tile, top: groundTop - b.s * 0.62, width: b.s, height: b.s, borderRadius: b.s / 2, backgroundColor: '#5fae2f', borderWidth: 3, borderColor: '#3f8a1d' }}
          />
        )),
      )}
    </>
  );
}

export function Ground({ width, height, offset }: { width: number; height: number; offset: number }) {
  const step = 26;
  const count = Math.ceil(width / step) + 3;
  const shift = offset % step;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height, backgroundColor: theme.sand, borderTopWidth: 3, borderTopColor: theme.ink }}>
      <View style={{ height: 16, backgroundColor: theme.grass, borderBottomWidth: 3, borderBottomColor: theme.ink, overflow: 'hidden' }}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ position: 'absolute', top: 0, left: i * step - shift - step, width: 12, height: 16, backgroundColor: theme.grassLight, transform: [{ skewX: '-38deg' }] }} />
        ))}
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.35)' }} />
      </View>
      <View style={{ height: 6, backgroundColor: theme.sandDark, opacity: 0.55 }} />
    </View>
  );
}

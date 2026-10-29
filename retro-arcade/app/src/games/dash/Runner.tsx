import { View } from 'react-native';
import { theme } from '../../ui/theme';

interface Props {
  /** Pixel height of the standing runner. */
  size: number;
  /** Run cycle in radians. */
  cycle: number;
  sliding?: boolean;
  jumping?: boolean;
  /** -1..1, leaning into a lane change. */
  lean?: number;
  jersey?: string;
  cap?: string;
}

/** The runner, seen from behind: red cap, orange hoodie, blue trousers, white sneakers. */
export default function Runner({ size, cycle, sliding, jumping, lean = 0, jersey = '#ff8a1f', cap = '#e8402e' }: Props) {
  const h = size;
  const w = size * 0.56;
  const b = Math.max(1.5, size / 28);
  const swing = jumping ? 0 : Math.sin(cycle);
  const legLift = (s: number) => (jumping ? -h * 0.05 : Math.max(0, s) * h * 0.1);
  const squash = sliding ? 0.55 : 1;

  const leg = (side: -1 | 1) => (
    <View
      style={{
        position: 'absolute',
        bottom: legLift(swing * side),
        left: w / 2 + side * w * 0.16 - w * 0.13,
        width: w * 0.26,
        height: h * 0.34,
        borderRadius: w * 0.1,
        backgroundColor: '#2f4a9e',
        borderWidth: b,
        borderColor: theme.ink,
        alignItems: 'center',
      }}
    >
      <View style={{ position: 'absolute', bottom: -b, width: w * 0.3, height: h * 0.1, borderRadius: h * 0.04, backgroundColor: '#fff', borderWidth: b, borderColor: theme.ink }} />
    </View>
  );

  const arm = (side: -1 | 1) => (
    <View
      style={{
        position: 'absolute',
        top: h * 0.36,
        left: w / 2 + side * w * 0.5 - w * 0.09,
        width: w * 0.18,
        height: h * 0.24,
        borderRadius: w * 0.09,
        backgroundColor: jersey,
        borderWidth: b,
        borderColor: theme.ink,
        transform: [{ rotate: `${swing * side * -28}deg` }],
      }}
    />
  );

  return (
    <View style={{ width: w, height: h, transform: [{ scaleY: squash }, { rotate: `${lean * 10}deg` }], transformOrigin: 'bottom' }}>
      {leg(-1)}
      {leg(1)}
      {arm(-1)}
      {arm(1)}
      {/* hoodie */}
      <View style={{ position: 'absolute', left: w * 0.08, right: w * 0.08, top: h * 0.3, height: h * 0.4, borderRadius: w * 0.22, backgroundColor: jersey, borderWidth: b, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: '44%', top: 0, bottom: 0, width: b * 1.5, backgroundColor: 'rgba(59,42,63,0.35)' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: h * 0.07, backgroundColor: '#e2701a' }} />
        <View style={{ position: 'absolute', left: w * 0.12, top: h * 0.05, width: w * 0.3, height: h * 0.05, borderRadius: h * 0.03, backgroundColor: 'rgba(255,255,255,0.4)' }} />
      </View>
      {/* head and cap */}
      <View style={{ position: 'absolute', left: w * 0.18, right: w * 0.18, top: h * 0.07, height: h * 0.28, borderRadius: w * 0.3, backgroundColor: '#ffd3a8', borderWidth: b, borderColor: theme.ink }} />
      <View style={{ position: 'absolute', left: w * 0.14, right: w * 0.14, top: h * 0.02, height: h * 0.2, borderTopLeftRadius: w * 0.34, borderTopRightRadius: w * 0.34, borderBottomLeftRadius: w * 0.08, borderBottomRightRadius: w * 0.08, backgroundColor: cap, borderWidth: b, borderColor: theme.ink }}>
        <View style={{ position: 'absolute', left: w * 0.1, top: h * 0.02, width: w * 0.22, height: h * 0.04, borderRadius: h * 0.02, backgroundColor: 'rgba(255,255,255,0.45)' }} />
      </View>
    </View>
  );
}

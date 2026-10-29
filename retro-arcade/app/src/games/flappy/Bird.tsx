import { View } from 'react-native';
import { theme } from '../../ui/theme';

interface Props {
  size?: number;
  /** Wing rotation in degrees. */
  wing?: number;
}

/** The bird, drawn from primitives so it scales for both the game and the app icon. */
export default function Bird({ size = 36, wing = 10 }: Props) {
  const w = size;
  const h = size * 0.78;
  const b = Math.max(1.5, size / 16);
  return (
    <View style={{ width: w, height: h }}>
      {/* tail feathers */}
      <View style={{ position: 'absolute', left: -w * 0.1, top: h * 0.3, width: w * 0.22, height: h * 0.22, borderRadius: w * 0.06, backgroundColor: '#e8b712', borderWidth: b, borderColor: theme.ink }} />
      {/* body */}
      <View style={{ position: 'absolute', inset: 0, borderRadius: h * 0.5, backgroundColor: '#f8d73a', borderWidth: b, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: w * 0.12, top: h * 0.08, width: w * 0.42, height: h * 0.16, borderRadius: h * 0.1, backgroundColor: 'rgba(255,255,255,0.55)' }} />
        <View style={{ position: 'absolute', left: w * 0.3, bottom: -h * 0.1, width: w * 0.7, height: h * 0.36, borderRadius: h * 0.2, backgroundColor: '#f9ecb0' }} />
      </View>
      {/* wing */}
      <View
        style={{
          position: 'absolute', left: w * 0.1, top: h * 0.4, width: w * 0.42, height: h * 0.3,
          borderRadius: h * 0.16, backgroundColor: '#fff3c4', borderWidth: b, borderColor: theme.ink,
          transform: [{ rotate: `${wing}deg` }],
        }}
      />
      {/* eye */}
      <View style={{ position: 'absolute', right: w * 0.12, top: h * 0.1, width: w * 0.3, height: w * 0.3, borderRadius: w * 0.15, backgroundColor: '#fff', borderWidth: b, borderColor: theme.ink }}>
        <View style={{ position: 'absolute', right: w * 0.04, top: w * 0.08, width: w * 0.1, height: w * 0.1, borderRadius: w * 0.05, backgroundColor: theme.ink }} />
      </View>
      {/* beak */}
      <View style={{ position: 'absolute', right: -w * 0.12, top: h * 0.46, width: w * 0.36, height: h * 0.2, borderRadius: h * 0.1, backgroundColor: '#f45b2a', borderWidth: b, borderColor: theme.ink }} />
      <View style={{ position: 'absolute', right: -w * 0.07, top: h * 0.62, width: w * 0.28, height: h * 0.16, borderRadius: h * 0.08, backgroundColor: '#f98d3c', borderWidth: b, borderColor: theme.ink }} />
    </View>
  );
}

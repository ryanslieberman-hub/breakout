import { View } from 'react-native';
import { theme } from '../../ui/theme';

interface Props {
  size?: number;
  /** -1 looking left, 1 looking right. */
  look?: number;
  /** >1 stretched (rising), <1 squashed (falling fast). */
  stretch?: number;
}

/** The Hop Hop blob: a green gumdrop with big eyes and tiny feet. Drawn from primitives like the bird. */
export default function Hopper({ size = 44, look = 1, stretch = 1 }: Props) {
  const b = Math.max(1.5, size / 15);
  const w = size * 0.86;
  const h = size;
  const eye = size * 0.26;
  const eyeY = h * 0.22;
  const shift = look * size * 0.025;
  return (
    <View style={{ width: w, height: h, transform: [{ scaleY: stretch }, { scaleX: 1 / Math.sqrt(stretch) }] }}>
      {/* feet */}
      <View style={{ position: 'absolute', left: w * 0.1, bottom: -b, width: w * 0.3, height: h * 0.13, borderRadius: h * 0.07, backgroundColor: '#5fa21d', borderWidth: b, borderColor: theme.ink }} />
      <View style={{ position: 'absolute', right: w * 0.1, bottom: -b, width: w * 0.3, height: h * 0.13, borderRadius: h * 0.07, backgroundColor: '#5fa21d', borderWidth: b, borderColor: theme.ink }} />
      {/* body */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: h * 0.06, borderTopLeftRadius: w * 0.5, borderTopRightRadius: w * 0.5, borderBottomLeftRadius: w * 0.3, borderBottomRightRadius: w * 0.3, backgroundColor: '#9be02f', borderWidth: b, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: w * 0.14, top: h * 0.07, width: w * 0.3, height: h * 0.12, borderRadius: h * 0.06, backgroundColor: 'rgba(255,255,255,0.5)' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: h * 0.2, backgroundColor: 'rgba(60,110,10,0.28)' }} />
        {/* spots */}
        <View style={{ position: 'absolute', right: w * 0.12, bottom: h * 0.28, width: w * 0.12, height: w * 0.12, borderRadius: w * 0.06, backgroundColor: 'rgba(60,110,10,0.35)' }} />
        <View style={{ position: 'absolute', left: w * 0.2, bottom: h * 0.18, width: w * 0.09, height: w * 0.09, borderRadius: w * 0.045, backgroundColor: 'rgba(60,110,10,0.35)' }} />
      </View>
      {/* eyes */}
      {[w * 0.17, w * 0.17 + eye * 0.95].map((l, i) => (
        <View key={i} style={{ position: 'absolute', left: l + shift, top: eyeY, width: eye, height: eye * 1.15, borderRadius: eye / 2, backgroundColor: '#fff', borderWidth: b, borderColor: theme.ink }}>
          <View style={{ position: 'absolute', left: eye * (0.34 + look * 0.12), top: eye * 0.42, width: eye * 0.38, height: eye * 0.38, borderRadius: eye * 0.2, backgroundColor: theme.ink }} />
        </View>
      ))}
      {/* mouth */}
      <View style={{ position: 'absolute', left: w * 0.36 + shift, top: h * 0.56, width: w * 0.28, height: h * 0.1, borderBottomLeftRadius: h * 0.1, borderBottomRightRadius: h * 0.1, borderWidth: b, borderTopWidth: 0, borderColor: theme.ink }} />
    </View>
  );
}

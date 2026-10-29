import { View } from 'react-native';
import { theme } from '../../ui/theme';

export type PlatformKind = 'grass' | 'moving' | 'crumble' | 'spring';

export const PLAT_W = 70;
export const PLAT_H = 18;

const FACE: Record<PlatformKind, { top: string; side: string }> = {
  grass: { top: '#8fd83a', side: '#5fa21d' },
  moving: { top: '#6ec6f5', side: '#2f89c4' },
  crumble: { top: '#d8a363', side: '#9a6a34' },
  spring: { top: '#8fd83a', side: '#5fa21d' },
};

/** A floating ledge. Spring ledges carry a coil that extends when triggered. */
export default function Platform({ kind, sprung, width = PLAT_W }: { kind: PlatformKind; sprung?: boolean; width?: number }) {
  const c = FACE[kind];
  return (
    <View style={{ width, height: PLAT_H }}>
      {kind === 'spring' && (
        <View style={{ position: 'absolute', left: PLAT_W / 2 - 9, bottom: PLAT_H - 3, width: 18, height: sprung ? 20 : 11, alignItems: 'center', justifyContent: 'flex-end' }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: i === 1 ? 16 : 18, height: sprung ? 5 : 3, marginTop: sprung ? 2 : 1, backgroundColor: i % 2 ? '#fff' : theme.red, borderWidth: 1.5, borderColor: theme.ink, borderRadius: 2 }} />
          ))}
        </View>
      )}
      <View style={{ flex: 1, borderRadius: 9, backgroundColor: c.side, borderWidth: 2.5, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ height: 9, backgroundColor: c.top }} />
        <View style={{ position: 'absolute', left: 8, top: 2, width: 18, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' }} />
        {kind === 'crumble' &&
          [18, 36, 52].map((l) => (
            <View key={l} style={{ position: 'absolute', left: l, top: 0, bottom: 0, width: 2, backgroundColor: theme.ink, opacity: 0.55, transform: [{ skewX: '-20deg' }] }} />
          ))}
        {kind === 'moving' && (
          <>
            <View style={{ position: 'absolute', left: 4, bottom: 1, width: 6, height: 3, backgroundColor: '#fff', opacity: 0.8 }} />
            <View style={{ position: 'absolute', right: 4, bottom: 1, width: 6, height: 3, backgroundColor: '#fff', opacity: 0.8 }} />
          </>
        )}
      </View>
    </View>
  );
}

import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Bird from '../games/flappy/Bird';
import { fonts, theme } from './theme';

/** Glossy 2013-style icon tile: gradient, hard outline, top gloss, soft drop shadow. */
export function IconShell({ size, colors, children }: { size: number; colors: [string, string]; children: React.ReactNode }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.225, boxShadow: '0px 4px 7px rgba(20,30,60,0.45)', backgroundColor: theme.ink, padding: 1.5 }}>
      <LinearGradient colors={colors} style={{ flex: 1, borderRadius: size * 0.2, overflow: 'hidden' }}>
        {children}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '48%', backgroundColor: 'rgba(255,255,255,0.22)', borderBottomLeftRadius: size, borderBottomRightRadius: size, transform: [{ scaleX: 1.5 }] }} />
        <View style={{ position: 'absolute', inset: 0, borderRadius: size * 0.2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }} />
      </LinearGradient>
    </View>
  );
}

export function FlappyIcon({ size }: { size: number }) {
  const s = size;
  return (
    <IconShell size={s} colors={['#35a8e0', '#bff0ee']}>
      <View style={{ position: 'absolute', left: s * 0.06, bottom: 0, width: s * 0.26, height: s * 0.5, backgroundColor: theme.grass, borderWidth: 2, borderColor: theme.ink }}>
        <View style={{ position: 'absolute', left: 2, top: 0, bottom: 0, width: 4, backgroundColor: theme.grassLight }} />
      </View>
      <View style={{ position: 'absolute', right: s * 0.06, top: 0, width: s * 0.26, height: s * 0.28, backgroundColor: theme.grass, borderWidth: 2, borderColor: theme.ink }}>
        <View style={{ position: 'absolute', left: 2, top: 0, bottom: 0, width: 4, backgroundColor: theme.grassLight }} />
      </View>
      <View style={{ position: 'absolute', left: s * 0.24, top: s * 0.28, transform: [{ rotate: '-14deg' }] }}>
        <Bird size={s * 0.5} wing={-30} />
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: s * 0.12, backgroundColor: theme.sand, borderTopWidth: 2, borderTopColor: theme.ink }} />
    </IconShell>
  );
}

export function HopIcon({ size }: { size: number }) {
  const s = size;
  const plat = (l: number, t: number, w: number) => (
    <View style={{ position: 'absolute', left: s * l, top: s * t, width: s * w, height: s * 0.1, borderRadius: s * 0.05, backgroundColor: '#8bd02f', borderWidth: 2, borderColor: theme.ink }} />
  );
  return (
    <IconShell size={s} colors={['#7fd6f5', '#e4f9ff']}>
      {plat(0.08, 0.78, 0.4)}{plat(0.52, 0.55, 0.38)}{plat(0.14, 0.34, 0.34)}
      <View style={{ position: 'absolute', left: s * 0.58, top: s * 0.26, width: s * 0.26, height: s * 0.3, borderRadius: s * 0.12, backgroundColor: '#a6e22e', borderWidth: 2, borderColor: theme.ink }}>
        <View style={{ position: 'absolute', left: s * 0.03, top: s * 0.07, width: s * 0.07, height: s * 0.07, borderRadius: s, backgroundColor: '#fff', borderWidth: 1.5, borderColor: theme.ink }} />
        <View style={{ position: 'absolute', right: s * 0.03, top: s * 0.07, width: s * 0.07, height: s * 0.07, borderRadius: s, backgroundColor: '#fff', borderWidth: 1.5, borderColor: theme.ink }} />
      </View>
    </IconShell>
  );
}

export function DashIcon({ size }: { size: number }) {
  const s = size;
  return (
    <IconShell size={s} colors={['#ff9f2e', '#e2491c']}>
      {[0.3, 0.5, 0.7].map((x) => (
        <View key={x} style={{ position: 'absolute', left: s * x - 1.5, top: s * 0.1, bottom: s * 0.1, width: 3, backgroundColor: 'rgba(255,255,255,0.55)' }} />
      ))}
      <View style={{ position: 'absolute', left: s * 0.38, top: s * 0.4, width: s * 0.24, height: s * 0.34, borderRadius: s * 0.1, backgroundColor: '#2a2140', borderWidth: 2, borderColor: '#fff' }} />
      <View style={{ position: 'absolute', left: s * 0.73, top: s * 0.2, width: s * 0.16, height: s * 0.16, borderRadius: s * 0.08, backgroundColor: theme.yellow, borderWidth: 2, borderColor: theme.ink }} />
    </IconShell>
  );
}

export function StackIcon({ size }: { size: number }) {
  const s = size;
  const block = (l: number, t: number, w: number, c: string) => (
    <View style={{ position: 'absolute', left: s * l, top: s * t, width: s * w, height: s * 0.16, backgroundColor: c, borderWidth: 2, borderColor: theme.ink, borderRadius: 3 }} />
  );
  return (
    <IconShell size={s} colors={['#8b5cf0', '#3b2a8f']}>
      {block(0.2, 0.7, 0.6, '#ff6b8a')}{block(0.26, 0.54, 0.5, '#ffd23f')}{block(0.3, 0.38, 0.42, '#4ee0a8')}{block(0.37, 0.22, 0.28, '#5aa9e8')}
    </IconShell>
  );
}

export function MergeIcon({ size }: { size: number }) {
  const s = size;
  const tile = (l: number, t: number, c: string, n: string, fs: number) => (
    <View style={{ position: 'absolute', left: s * l, top: s * t, width: s * 0.38, height: s * 0.38, borderRadius: s * 0.07, backgroundColor: c, borderWidth: 2, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.display, fontSize: s * fs, color: theme.ink }}>{n}</Text>
    </View>
  );
  return (
    <IconShell size={s} colors={['#f4e3b3', '#d9b97a']}>
      {tile(0.08, 0.1, '#f9c74f', '4', 0.2)}{tile(0.54, 0.1, '#f8961e', '8', 0.2)}{tile(0.08, 0.52, '#90be6d', '2', 0.2)}{tile(0.54, 0.52, '#f3722c', '16', 0.17)}
    </IconShell>
  );
}

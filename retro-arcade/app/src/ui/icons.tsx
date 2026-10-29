import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Runner from '../games/dash/Runner';
import Bird from '../games/flappy/Bird';
import Hopper from '../games/hop/Hopper';
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
    <View style={{ position: 'absolute', left: s * l, top: s * t, width: s * w, height: s * 0.12, borderRadius: s * 0.06, backgroundColor: '#5fa21d', borderWidth: 2, borderColor: theme.ink, overflow: 'hidden' }}>
      <View style={{ height: '55%', backgroundColor: '#8fd83a' }} />
    </View>
  );
  return (
    <IconShell size={s} colors={['#5cc4f2', '#e4f9ff']}>
      {plat(0.06, 0.8, 0.42)}{plat(0.58, 0.58, 0.36)}{plat(0.08, 0.3, 0.3)}
      <View style={{ position: 'absolute', left: s * 0.3, top: s * 0.3 }}>
        <Hopper size={s * 0.48} look={1} stretch={1.08} />
      </View>
    </IconShell>
  );
}

export function DashIcon({ size }: { size: number }) {
  const s = size;
  return (
    <IconShell size={s} colors={['#4a3a9c', '#ffb07a']}>
      <View style={{ position: 'absolute', left: s * 0.56, top: s * 0.2, width: s * 0.3, height: s * 0.3, borderRadius: s * 0.15, backgroundColor: '#fff2b0' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: s * 0.62, backgroundColor: '#3f9c55' }} />
      <View
        style={{
          position: 'absolute', left: s * 0.02, bottom: 0, width: s * 0.16, height: 0,
          borderBottomWidth: s * 0.62, borderBottomColor: '#4b4560',
          borderLeftWidth: s * 0.4, borderRightWidth: s * 0.4, borderLeftColor: 'transparent', borderRightColor: 'transparent',
        }}
      />
      {[0.2, 0.36, 0.52].map((y, i) => (
        <View key={y} style={{ position: 'absolute', left: s * 0.5 - (2 + i * 1.4), bottom: s * y, width: 4 + i * 2.8, height: 2 + i, backgroundColor: 'rgba(255,255,255,0.8)' }} />
      ))}
      <View style={{ position: 'absolute', left: s * 0.5 - s * 0.14, bottom: s * 0.03 }}>
        <Runner size={s * 0.46} cycle={0.9} />
      </View>
      <View style={{ position: 'absolute', left: s * 0.68, bottom: s * 0.34, width: s * 0.13, height: s * 0.13, borderRadius: s, backgroundColor: theme.yellow, borderWidth: 2, borderColor: theme.ink }} />
    </IconShell>
  );
}

export function StackIcon({ size }: { size: number }) {
  const s = size;
  const block = (l: number, t: number, w: number, hue: number) => (
    <View style={{ position: 'absolute', left: s * l, top: s * t, width: s * w, height: s * 0.15, backgroundColor: `hsl(${hue}, 78%, 58%)`, borderWidth: 2, borderColor: theme.ink, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ height: '35%', backgroundColor: `hsl(${hue}, 78%, 74%)` }} />
    </View>
  );
  return (
    <IconShell size={s} colors={['#2ba7d9', '#c9f0ee']}>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: s * 0.13, backgroundColor: theme.grass, borderTopWidth: 2, borderTopColor: theme.ink }} />
      {block(0.17, 0.72, 0.66, 200)}{block(0.22, 0.57, 0.56, 235)}{block(0.27, 0.42, 0.44, 270)}{block(0.36, 0.27, 0.3, 305)}
      {block(0.58, 0.12, 0.3, 340)}
    </IconShell>
  );
}

export function MergeIcon({ size }: { size: number }) {
  const s = size;
  const tile = (l: number, t: number, bg: string, n: string, fg: string, fs: number) => (
    <View style={{ position: 'absolute', left: s * l, top: s * t, width: s * 0.33, height: s * 0.33, borderRadius: s * 0.06, backgroundColor: bg, borderWidth: 2, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '38%', backgroundColor: 'rgba(255,255,255,0.28)' }} />
      <Text style={{ fontFamily: fonts.display, fontSize: s * fs, color: fg }}>{n}</Text>
    </View>
  );
  return (
    <IconShell size={s} colors={['#ffd98a', '#f4a85e']}>
      <View style={{ position: 'absolute', left: s * 0.1, top: s * 0.1, width: s * 0.8, height: s * 0.8, borderRadius: s * 0.1, backgroundColor: '#b57a3e', borderWidth: 2.5, borderColor: theme.ink }} />
      {tile(0.17, 0.17, '#fff1c1', '2', theme.ink, 0.2)}
      {tile(0.5, 0.17, '#ffb74d', '8', theme.ink, 0.2)}
      {tile(0.17, 0.5, '#ff8a50', '16', '#fff', 0.17)}
      {tile(0.5, 0.5, '#e8402e', '64', '#fff', 0.17)}
    </IconShell>
  );
}

export function BaseballIcon({ size }: { size: number }) {
  const s = size;
  const base = (l: number, t: number) => (
    <View style={{ position: 'absolute', left: s * l, top: s * t, width: s * 0.1, height: s * 0.1, backgroundColor: '#fff', borderWidth: 1.5, borderColor: theme.ink, transform: [{ rotate: '45deg' }] }} />
  );
  return (
    <IconShell size={s} colors={['#5cc06f', '#2f8a4a']}>
      <View style={{ position: 'absolute', left: s * 0.2, top: s * 0.28, width: s * 0.6, height: s * 0.6, backgroundColor: '#d9a066', borderWidth: 2.5, borderColor: theme.ink, transform: [{ rotate: '45deg' }] }}>
        <View style={{ position: 'absolute', left: '20%', top: '20%', right: '20%', bottom: '20%', backgroundColor: '#4fb36a', borderWidth: 1.5, borderColor: 'rgba(59,42,63,0.5)' }} />
      </View>
      {base(0.45, 0.2)}{base(0.15, 0.55)}{base(0.75, 0.55)}{base(0.45, 0.85)}
      <View style={{ position: 'absolute', left: s * 0.42, top: s * 0.38, width: s * 0.26, height: s * 0.26, borderRadius: s * 0.13, backgroundColor: '#fff', borderWidth: 2, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: -s * 0.1, top: s * 0.03, width: s * 0.16, height: s * 0.2, borderRadius: s * 0.1, borderWidth: 1.5, borderColor: theme.red }} />
        <View style={{ position: 'absolute', right: -s * 0.1, top: s * 0.03, width: s * 0.16, height: s * 0.2, borderRadius: s * 0.1, borderWidth: 1.5, borderColor: theme.red }} />
      </View>
    </IconShell>
  );
}

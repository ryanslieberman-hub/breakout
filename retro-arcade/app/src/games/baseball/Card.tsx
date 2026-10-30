import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';
import { fonts, theme } from '../../ui/theme';
import Bust from './Bust';
import { RARITY, type Player, type Rarity } from './league';

export const NAVY = '#0c1634';
export const GOLD = '#f5c542';

const FOIL: Record<Rarity, [string, string, ...string[]]> = {
  common: ['#d4d9e4', '#8a90a3', '#d4d9e4'],
  uncommon: ['#9be8b0', '#2f9e55', '#9be8b0'],
  rare: ['#9ccbff', '#2f6fd0', '#9ccbff'],
  epic: ['#dcbcff', '#7b3fd0', '#dcbcff'],
  legend: ['#fff3b0', '#f2a900', '#fff7d6', '#f2a900', '#fff3b0'],
};

const tierColor = (v: number) => (v >= 85 ? GOLD : v >= 70 ? '#7ee08f' : v >= 55 ? '#ffffff' : '#aab0c4');

function Stat({ label, value, w }: { label: string; value: number; w: number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.pixelBold, fontSize: Math.max(6, w * 0.06), color: '#8f9bc0', letterSpacing: 0.5 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.display, fontSize: w * 0.15, lineHeight: w * 0.17, color: tierColor(value) }}>{value}</Text>
      <View style={{ width: '70%', height: Math.max(2, w * 0.022), borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
        <View style={{ width: `${value}%`, height: '100%', backgroundColor: tierColor(value) }} />
      </View>
    </View>
  );
}

/** A collectible player card. Height is 1.5x the width. */
export default function PlayerCard({ p, width, dim }: { p: Player; width: number; dim?: boolean }) {
  const w = width;
  const h = w * 1.5;
  const r = RARITY[p.rarity];
  const b = Math.max(2, w * 0.035);
  return (
    <View style={{ width: w, height: h, borderRadius: w * 0.1, opacity: dim ? 0.4 : 1, boxShadow: '0px 5px 8px rgba(0,0,10,0.45)', backgroundColor: theme.ink }}>
      <LinearGradient colors={FOIL[p.rarity]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: w * 0.1, padding: b, margin: 1.5 }}>
        <View style={{ flex: 1, borderRadius: w * 0.07, overflow: 'hidden', borderWidth: 1.5, borderColor: theme.ink, backgroundColor: NAVY }}>
          {/* art window */}
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <LinearGradient colors={[p.team.color, '#0c1634']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ ...{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } }} />
            <View style={{ position: 'absolute', left: -w * 0.2, top: -w * 0.1, width: w * 0.5, height: h, backgroundColor: 'rgba(255,255,255,0.1)', transform: [{ rotate: '24deg' }] }} />
            <View style={{ position: 'absolute', left: w * 0.38, top: -w * 0.1, width: w * 0.16, height: h, backgroundColor: 'rgba(255,255,255,0.07)', transform: [{ rotate: '24deg' }] }} />
            <Text style={{ position: 'absolute', right: -w * 0.04, bottom: -w * 0.1, fontFamily: fonts.display, fontSize: w * 0.85, lineHeight: w * 0.95, color: 'rgba(255,255,255,0.09)' }}>{p.team.city[0]}</Text>
            <View style={{ position: 'absolute', left: w * 0.06, right: w * 0.06, bottom: -w * 0.03 }}>
              <Bust p={p} w={w * 0.86} />
            </View>
            {/* ovr shield */}
            <View style={{ position: 'absolute', left: w * 0.04, top: w * 0.04, width: w * 0.25, paddingTop: w * 0.012, paddingBottom: w * 0.02, borderRadius: w * 0.05, borderBottomLeftRadius: w * 0.12, borderBottomRightRadius: w * 0.12, backgroundColor: NAVY, borderWidth: b * 0.6, borderColor: GOLD, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.display, fontSize: w * 0.17, lineHeight: w * 0.19, color: '#fff' }}>{p.ovr}</Text>
              <Text style={{ fontFamily: fonts.pixelBold, fontSize: Math.max(7, w * 0.065), color: GOLD }}>{p.pos}</Text>
            </View>
            {/* rarity gem */}
            <View style={{ position: 'absolute', right: w * 0.07, top: w * 0.07, width: w * 0.12, height: w * 0.12, backgroundColor: r.frame, borderWidth: b * 0.6, borderColor: theme.ink, transform: [{ rotate: '45deg' }], overflow: 'hidden' }}>
              <View style={{ position: 'absolute', left: 0, top: 0, width: '60%', height: '60%', backgroundColor: 'rgba(255,255,255,0.6)' }} />
            </View>
          </View>
          {/* plate */}
          <LinearGradient colors={['#1b2a5c', NAVY]} style={{ paddingHorizontal: w * 0.04, paddingTop: w * 0.03, paddingBottom: w * 0.035 }}>
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(2, w * 0.02), backgroundColor: r.frame }} />
            <Text numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: w * 0.125, lineHeight: w * 0.14, color: '#fff', textAlign: 'center' }}>{p.first[0]}. {p.last}</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.pixelBold, fontSize: Math.max(6, w * 0.056), color: GOLD, textAlign: 'center', letterSpacing: 0.8, marginBottom: w * 0.025 }}>
              {p.team.name.toUpperCase()}
            </Text>
            <View style={{ flexDirection: 'row', gap: w * 0.03 }}>
              <Stat label="CON" value={p.contact} w={w} />
              <Stat label="POW" value={p.power} w={w} />
              <Stat label="SPD" value={p.speed} w={w} />
            </View>
          </LinearGradient>
        </View>
        {p.rarity === 'legend' && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: w * 0.1, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', left: w * 0.25, top: -w * 0.2, width: w * 0.22, height: h * 1.3, backgroundColor: 'rgba(255,255,255,0.2)', transform: [{ rotate: '22deg' }] }} />
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

/** Card back shown before a pack card is revealed. */
export function CardBack({ width }: { width: number }) {
  const w = width;
  const h = w * 1.5;
  return (
    <View style={{ width: w, height: h, borderRadius: w * 0.1, backgroundColor: theme.ink, boxShadow: '0px 5px 8px rgba(0,0,10,0.45)' }}>
      <LinearGradient colors={['#fff3b0', '#f2a900', '#fff3b0']} style={{ flex: 1, margin: 1.5, borderRadius: w * 0.1, padding: w * 0.035 }}>
        <LinearGradient colors={['#1b2a5c', NAVY]} style={{ flex: 1, borderRadius: w * 0.07, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1.5, borderColor: theme.ink }}>
          {[-0.3, 0, 0.3, 0.6].map((x) => (
            <View key={x} style={{ position: 'absolute', left: w * x, top: -w * 0.2, width: w * 0.1, height: h * 1.3, backgroundColor: 'rgba(245,197,66,0.12)', transform: [{ rotate: '24deg' }] }} />
          ))}
          <View style={{ width: w * 0.5, height: w * 0.5, borderRadius: w * 0.25, backgroundColor: '#fff', borderWidth: w * 0.03, borderColor: GOLD, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', left: -w * 0.18, top: w * 0.06, width: w * 0.3, height: w * 0.36, borderRadius: w * 0.2, borderWidth: 2, borderColor: theme.red }} />
            <View style={{ position: 'absolute', right: -w * 0.18, top: w * 0.06, width: w * 0.3, height: w * 0.36, borderRadius: w * 0.2, borderWidth: 2, borderColor: theme.red }} />
          </View>
        </LinearGradient>
      </LinearGradient>
    </View>
  );
}

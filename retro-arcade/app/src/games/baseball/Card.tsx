import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';
import StrokedText from '../../ui/StrokedText';
import { fonts, theme } from '../../ui/theme';
import { RARITY, type Player } from './league';

function Bar({ label, value, w }: { label: string; value: number; w: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: w * 0.03 }}>
      <Text style={{ width: w * 0.2, fontFamily: fonts.pixelBold, fontSize: Math.max(7, w * 0.058), color: theme.ink }}>{label}</Text>
      <View style={{ flex: 1, height: w * 0.05, borderRadius: w * 0.025, backgroundColor: 'rgba(59,42,63,0.25)', borderWidth: 1, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ width: `${value}%`, height: '100%', backgroundColor: value >= 85 ? '#ffd23f' : value >= 65 ? '#4fb36a' : '#9a9fb0' }} />
      </View>
    </View>
  );
}

/** A collectible player card. Height is 1.42x the width. */
export default function PlayerCard({ p, width, dim }: { p: Player; width: number; dim?: boolean }) {
  const w = width;
  const h = w * 1.42;
  const r = RARITY[p.rarity];
  const b = Math.max(2, w * 0.03);
  const head = w * 0.3;
  return (
    <View style={{ width: w, height: h, borderRadius: w * 0.09, backgroundColor: theme.ink, padding: b, opacity: dim ? 0.45 : 1, boxShadow: '0px 4px 6px rgba(20,20,40,0.35)' }}>
      <View style={{ flex: 1, borderRadius: w * 0.07, borderWidth: b, borderColor: r.frame, overflow: 'hidden' }}>
        <LinearGradient colors={[r.glow, '#ffffff', r.glow]} style={{ flex: 1, padding: w * 0.05 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <StrokedText size={w * 0.26} width={Math.max(1.5, w * 0.012)} color={theme.white}>{p.ovr}</StrokedText>
              <Text style={{ fontFamily: fonts.pixelBold, fontSize: Math.max(8, w * 0.07), color: theme.ink, textAlign: 'center' }}>{p.pos}</Text>
            </View>
            <View style={{ width: w * 0.13, height: w * 0.13, borderRadius: w * 0.065, backgroundColor: p.team.color, borderWidth: b * 0.7, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: w * 0.05, height: w * 0.05, borderRadius: w * 0.025, backgroundColor: p.team.accent }} />
            </View>
          </View>

          {/* portrait */}
          <View style={{ height: h * 0.3, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
            <View style={{ width: w * 0.62, height: h * 0.14, borderTopLeftRadius: w * 0.3, borderTopRightRadius: w * 0.3, backgroundColor: p.team.color, borderWidth: b * 0.7, borderBottomWidth: 0, borderColor: theme.ink, alignItems: 'center' }}>
              <View style={{ width: w * 0.08, height: h * 0.05, backgroundColor: p.team.accent, marginTop: 0, borderBottomLeftRadius: w * 0.04, borderBottomRightRadius: w * 0.04 }} />
            </View>
            <View style={{ position: 'absolute', bottom: h * 0.115, width: head, height: head * 1.1, borderRadius: head * 0.5, backgroundColor: p.skin, borderWidth: b * 0.7, borderColor: theme.ink }}>
              <View style={{ position: 'absolute', left: head * 0.22, top: head * 0.5, width: head * 0.12, height: head * 0.12, borderRadius: head, backgroundColor: theme.ink }} />
              <View style={{ position: 'absolute', right: head * 0.22, top: head * 0.5, width: head * 0.12, height: head * 0.12, borderRadius: head, backgroundColor: theme.ink }} />
            </View>
            {/* cap */}
            <View style={{ position: 'absolute', bottom: h * 0.115 + head * 0.62, width: head * 1.05, height: head * 0.5, borderTopLeftRadius: head * 0.5, borderTopRightRadius: head * 0.5, backgroundColor: p.team.color, borderWidth: b * 0.7, borderColor: theme.ink }} />
            <View style={{ position: 'absolute', bottom: h * 0.115 + head * 0.58, left: w * 0.5 - head * 0.2, width: head * 0.9, height: head * 0.14, borderRadius: head * 0.1, backgroundColor: p.team.color, borderWidth: b * 0.7, borderColor: theme.ink }} />
          </View>

          <View style={{ backgroundColor: theme.ink, borderRadius: w * 0.03, paddingVertical: w * 0.012, marginTop: w * 0.02 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: w * 0.105, color: '#fff', textAlign: 'center' }}>{p.last}</Text>
          </View>
          <Text numberOfLines={1} style={{ fontFamily: fonts.pixel, fontSize: Math.max(7, w * 0.055), color: theme.ink, textAlign: 'center', marginTop: w * 0.012, opacity: 0.75 }}>
            {p.team.name.toUpperCase()} · {r.label}
          </Text>

          <View style={{ gap: w * 0.016, marginTop: w * 0.03 }}>
            <Bar label="CON" value={p.contact} w={w} />
            <Bar label="POW" value={p.power} w={w} />
            <Bar label="SPD" value={p.speed} w={w} />
          </View>

        </LinearGradient>
      </View>
    </View>
  );
}

/** Card back shown before a pack card is revealed. */
export function CardBack({ width }: { width: number }) {
  const w = width;
  const h = w * 1.42;
  return (
    <View style={{ width: w, height: h, borderRadius: w * 0.09, backgroundColor: theme.ink, padding: w * 0.03 }}>
      <LinearGradient colors={['#e8402e', '#a8301f']} style={{ flex: 1, borderRadius: w * 0.07, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' }}>
        <View style={{ width: w * 0.5, height: w * 0.5, borderRadius: w * 0.25, backgroundColor: '#fff', borderWidth: 3, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: -w * 0.2, top: w * 0.08, width: w * 0.3, height: w * 0.4, borderRadius: w * 0.2, borderWidth: 2, borderColor: theme.red }} />
          <View style={{ position: 'absolute', right: -w * 0.2, top: w * 0.08, width: w * 0.3, height: w * 0.4, borderRadius: w * 0.2, borderWidth: 2, borderColor: theme.red }} />
        </View>
      </LinearGradient>
    </View>
  );
}

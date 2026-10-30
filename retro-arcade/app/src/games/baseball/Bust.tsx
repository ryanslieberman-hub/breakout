import { Text, View } from 'react-native';
import { fonts, theme } from '../../ui/theme';
import type { Player, Team } from './league';

const shade = (a: number) => `rgba(0,0,0,${a})`;
const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 170;
};

/** Cap with brim and club letter, shared by the bust and the full figures. */
export function Cap({ w, team, y = 0 }: { w: number; team: Team; y?: number }) {
  const b = Math.max(1.5, w * 0.022);
  return (
    <>
      <View style={{ position: 'absolute', left: w * 0.23, top: y, width: w * 0.54, height: w * 0.3, borderTopLeftRadius: w * 0.27, borderTopRightRadius: w * 0.27, borderBottomLeftRadius: w * 0.04, borderBottomRightRadius: w * 0.04, backgroundColor: team.color, borderWidth: b, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: '12%', top: '10%', width: '34%', height: '16%', borderRadius: w, backgroundColor: 'rgba(255,255,255,0.35)' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '25%', backgroundColor: shade(0.2) }} />
        <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: b, backgroundColor: shade(0.18) }} />
      </View>
      <View style={{ position: 'absolute', left: w * 0.43, top: y + w * 0.075, width: w * 0.14, height: w * 0.14, borderRadius: w * 0.07, backgroundColor: team.accent, borderWidth: b * 0.8, borderColor: theme.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.display, fontSize: w * 0.09, lineHeight: w * 0.1, color: isLight(team.accent) ? theme.ink : team.color, includeFontPadding: false }}>{team.city[0]}</Text>
      </View>
      <View style={{ position: 'absolute', left: w * 0.2, top: y + w * 0.255, width: w * 0.6, height: w * 0.075, borderRadius: w * 0.04, backgroundColor: team.color, borderWidth: b, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%', backgroundColor: shade(0.22) }} />
      </View>
    </>
  );
}

/** Head-and-shoulders portrait, drawn from shapes. Variation comes from the player id. */
export default function Bust({ p, w }: { p: Player; w: number }) {
  const b = Math.max(1.5, w * 0.022);
  const t = p.team;
  const skinDark = shade(0.14);
  const mouth = p.id % 3;
  const stubble = p.id % 4 === 0;
  const pin = isLight(t.accent);
  const num = (p.id % 38) + 2;
  return (
    <View style={{ width: w, height: w * 1.02 }}>
      {/* shoulders */}
      <View style={{ position: 'absolute', left: w * 0.04, width: w * 0.92, top: w * 0.66, height: w * 0.5, borderTopLeftRadius: w * 0.34, borderTopRightRadius: w * 0.34, backgroundColor: t.color, borderWidth: b, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '36%', backgroundColor: 'rgba(255,255,255,0.12)' }} />
        {[0.14, 0.26, 0.74, 0.86].map((x) => <View key={x} style={{ position: 'absolute', left: `${x * 100}%`, top: 0, bottom: 0, width: b * 0.7, backgroundColor: pin ? shade(0.12) : 'rgba(255,255,255,0.16)' }} />)}
        <View style={{ position: 'absolute', left: '49%', top: 0, bottom: 0, width: b * 1.6, backgroundColor: t.accent }} />
        <Text style={{ position: 'absolute', left: '60%', top: '34%', fontFamily: fonts.display, fontSize: w * 0.15, color: t.accent, opacity: 0.95 }}>{num}</Text>
      </View>
      {/* neck */}
      <View style={{ position: 'absolute', left: w * 0.395, top: w * 0.54, width: w * 0.21, height: w * 0.18, backgroundColor: p.skin, borderLeftWidth: b, borderRightWidth: b, borderColor: theme.ink }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '55%', backgroundColor: skinDark }} />
      </View>
      <View style={{ position: 'absolute', left: w * 0.4, top: w * 0.665, width: w * 0.2, height: w * 0.1, borderBottomLeftRadius: w * 0.1, borderBottomRightRadius: w * 0.1, backgroundColor: t.accent, borderWidth: b, borderTopWidth: 0, borderColor: theme.ink }} />
      {/* ears */}
      {[0.225, 0.715].map((x) => (
        <View key={x} style={{ position: 'absolute', left: w * x, top: w * 0.34, width: w * 0.065, height: w * 0.1, borderRadius: w * 0.04, backgroundColor: p.skin, borderWidth: b, borderColor: theme.ink }} />
      ))}
      {/* head */}
      <View style={{ position: 'absolute', left: w * 0.27, top: w * 0.13, width: w * 0.46, height: w * 0.52, borderRadius: w * 0.22, borderBottomLeftRadius: w * 0.2, borderBottomRightRadius: w * 0.2, backgroundColor: p.skin, borderWidth: b, borderColor: theme.ink, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '30%', backgroundColor: stubble ? 'rgba(40,25,20,0.3)' : skinDark }} />
        <View style={{ position: 'absolute', left: '12%', top: '30%', width: '22%', height: '10%', borderRadius: w, backgroundColor: 'rgba(255,255,255,0.18)' }} />
      </View>
      {/* brows, eyes, nose, mouth */}
      {[0.335, 0.555].map((x, i) => (
        <View key={x}>
          <View style={{ position: 'absolute', left: w * (x - 0.005), top: w * 0.355, width: w * 0.115, height: w * 0.024, borderRadius: w, backgroundColor: p.hair, transform: [{ rotate: `${i ? 6 : -6}deg` }] }} />
          <View style={{ position: 'absolute', left: w * x, top: w * 0.385, width: w * 0.105, height: w * 0.085, borderRadius: w * 0.05, backgroundColor: '#fff', borderWidth: b * 0.7, borderColor: theme.ink }}>
            <View style={{ position: 'absolute', left: w * 0.03, top: w * 0.012, width: w * 0.045, height: w * 0.05, borderRadius: w * 0.03, backgroundColor: '#2b1d16' }} />
          </View>
        </View>
      ))}
      <View style={{ position: 'absolute', left: w * 0.465, top: w * 0.45, width: w * 0.07, height: w * 0.085, borderBottomLeftRadius: w * 0.05, borderBottomRightRadius: w * 0.05, backgroundColor: skinDark }} />
      {mouth === 0 && <View style={{ position: 'absolute', left: w * 0.43, top: w * 0.54, width: w * 0.14, height: w * 0.05, borderBottomLeftRadius: w * 0.08, borderBottomRightRadius: w * 0.08, borderWidth: b, borderTopWidth: 0, borderColor: theme.ink }} />}
      {mouth === 1 && <View style={{ position: 'absolute', left: w * 0.415, top: w * 0.535, width: w * 0.17, height: w * 0.065, borderBottomLeftRadius: w * 0.09, borderBottomRightRadius: w * 0.09, backgroundColor: '#fff', borderWidth: b, borderColor: theme.ink }} />}
      {mouth === 2 && <View style={{ position: 'absolute', left: w * 0.44, top: w * 0.55, width: w * 0.12, height: b, backgroundColor: theme.ink }} />}
      {/* sideburns + cap */}
      {[0.265, 0.705].map((x) => <View key={x} style={{ position: 'absolute', left: w * x, top: w * 0.27, width: w * 0.03, height: w * 0.12, backgroundColor: p.hair }} />)}
      <Cap w={w} team={t} y={w * 0.02} />
    </View>
  );
}

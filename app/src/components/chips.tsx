import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, space } from '@/lib/theme';

export function Chips<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string; hint?: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[styles.chip, on && styles.on]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[styles.text, on && { color: colors.paper }]}>{o.label}</Text>
            {o.hint ? <Text style={[styles.hint, on && { color: colors.line }]}>{o.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// Rough RSSI cut-offs. Real rooms vary, so the organiser can change it mid-session.
export const RANGE_OPTIONS = [
  { value: -68, label: 'Small room', hint: 'tight' },
  { value: -75, label: 'Classroom', hint: 'default' },
  { value: -85, label: 'Lecture hall', hint: 'loose' },
];

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: { borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, borderRadius: radius.sm, paddingHorizontal: space(3), paddingVertical: space(2), alignItems: 'center' },
  on: { backgroundColor: colors.ink, borderColor: colors.ink },
  text: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, marginTop: 1 },
});

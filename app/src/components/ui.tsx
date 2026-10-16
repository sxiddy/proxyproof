import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps, type TextProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/lib/theme';

export function Screen({ children, scroll = true, refreshing, onRefresh, footer, padded = true }: {
  children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; footer?: ReactNode; padded?: boolean;
}) {
  const inner = padded ? styles.pad : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, { paddingBottom: space(10) }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
      {footer ? <SafeAreaView edges={['bottom']} style={styles.footer}>{footer}</SafeAreaView> : null}
    </SafeAreaView>
  );
}

export function TopBar({ title, back = true, right }: { title?: string; back?: boolean; right?: ReactNode }) {
  return (
    <View style={styles.topBar}>
      {back ? (
        <Pressable hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
      ) : <View />}
      {title ? <Text style={styles.topTitle} numberOfLines={1}>{title}</Text> : null}
      <View style={{ minWidth: 48, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

type TP = TextProps & { children: ReactNode; color?: string; center?: boolean };
const mk = (base: object) => ({ style, color, center, ...p }: TP) => (
  <Text {...p} style={[base, color ? { color } : null, center ? { textAlign: 'center' } : null, style]} />
);
export const H1 = mk({ fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.ink, letterSpacing: -0.5 });
export const H2 = mk({ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.ink });
export const H3 = mk({ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink });
export const Body = mk({ fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkSoft });
export const Small = mk({ fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted });
export const Label = mk({ fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.muted });
export const Mono = mk({ fontFamily: fonts.mono, fontSize: 14, color: colors.ink });
export const Italic = mk({ fontFamily: fonts.displayItalic, fontSize: 17, lineHeight: 24, color: colors.inkSoft });

export function Button({ title, onPress, kind = 'primary', loading, disabled, small, style }: {
  title: string; onPress?: () => void; kind?: 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';
  loading?: boolean; disabled?: boolean; small?: boolean; style?: ViewStyle;
}) {
  const k = buttonKinds[kind];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn, small && styles.btnSmall, { backgroundColor: k.bg, borderColor: k.border },
        pressed && { transform: [{ translateY: 1 }], opacity: 0.9 }, off && { opacity: 0.5 }, style,
      ]}
    >
      {loading ? <ActivityIndicator color={k.fg} /> : <Text style={[styles.btnText, small && { fontSize: 14 }, { color: k.fg }]}>{title}</Text>}
    </Pressable>
  );
}

const buttonKinds = {
  primary: { bg: colors.ink, fg: colors.paper, border: colors.ink },
  accent: { bg: colors.accent, fg: colors.white, border: colors.accent },
  outline: { bg: 'transparent', fg: colors.ink, border: colors.ink },
  ghost: { bg: 'transparent', fg: colors.inkSoft, border: 'transparent' },
  danger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
};

// React 19 passes ref as a normal prop, so no forwardRef needed.
export function Field({ label, hint, error, style, ref, ...p }: TextInputProps & { label: string; hint?: string; error?: string | null; ref?: React.Ref<any> }) {
    return (
      <View style={{ marginBottom: space(4) }}>
        <Label style={{ marginBottom: space(1.5) }}>{label}</Label>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          {...p}
          style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        />
        {error ? <Small color={colors.danger} style={{ marginTop: 4 }}>{error}</Small> : hint ? <Small style={{ marginTop: 4 }}>{hint}</Small> : null}
      </View>
    );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.sunk }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Tag({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'live' }) {
  const t = tagTones[tone];
  return (
    <View style={[styles.tag, { backgroundColor: t.bg }]}>
      {tone === 'live' ? <View style={styles.liveDot} /> : null}
      <Text style={[styles.tagText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

const tagTones = {
  neutral: { bg: colors.sunk, fg: colors.inkSoft },
  ok: { bg: colors.okSoft, fg: colors.ok },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  accent: { bg: colors.accentSoft, fg: colors.accent },
  live: { bg: colors.accentSoft, fg: colors.accent },
};

export function Banner({ tone = 'warn', title, children, action }: { tone?: 'warn' | 'danger' | 'ok' | 'info'; title: string; children?: ReactNode; action?: ReactNode }) {
  const t = { warn: [colors.warnSoft, colors.warn], danger: [colors.dangerSoft, colors.danger], ok: [colors.okSoft, colors.ok], info: [colors.sunk, colors.inkSoft] }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t[0], borderLeftColor: t[1] }]}>
      <H3 style={{ color: t[1], marginBottom: children ? 2 : 0 }}>{title}</H3>
      {typeof children === 'string' ? <Body style={{ fontSize: 14 }}>{children}</Body> : children}
      {action ? <View style={{ marginTop: space(3) }}>{action}</View> : null}
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Italic center style={{ color: colors.ink, fontSize: 19 }}>{title}</Italic>
      {children ? <Body center style={{ marginTop: space(2) }}>{children}</Body> : null}
    </View>
  );
}

export function Rule({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: colors.line, marginVertical: space(4) }, style]} />;
}

export function Loading() {
  return <View style={{ paddingVertical: space(16), alignItems: 'center' }}><ActivityIndicator color={colors.accent} /></View>;
}

/** The little rubber-stamp "PRESENT" mark. Slightly crooked on purpose. */
export function Stamp({ text = 'Present', color = colors.ok, size = 1 }: { text?: string; color?: string; size?: number }) {
  return (
    <View style={[styles.stamp, { borderColor: color, transform: [{ rotate: '-6deg' }, { scale: size }] }]}>
      <Text style={[styles.stampText, { color }]}>{text}</Text>
    </View>
  );
}

/** Attendance meter: a thin bar with a tick at the usual 75% requirement. */
export function Meter({ value, height = 8 }: { value: number | null; height?: number }) {
  const v = value ?? 0;
  const color = value == null ? colors.line : v >= 75 ? colors.ok : v >= 60 ? colors.warn : colors.danger;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: colors.sunk, overflow: 'hidden' }}>
      <View style={{ width: `${v}%`, height: '100%', backgroundColor: color, borderRadius: height }} />
      <View style={{ position: 'absolute', left: '75%', top: 0, bottom: 0, width: 2, backgroundColor: colors.paper }} />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  pad: { paddingHorizontal: space(5), paddingTop: space(2) },
  footer: { paddingHorizontal: space(5), paddingTop: space(3), paddingBottom: space(3), backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space(3), marginBottom: space(2) },
  back: { fontFamily: fonts.medium, fontSize: 15, color: colors.inkSoft },
  topTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, flex: 1, textAlign: 'center', marginHorizontal: space(2) },
  btn: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(5) },
  btnSmall: { minHeight: 38, paddingHorizontal: space(3.5), borderRadius: radius.sm },
  btnText: { fontFamily: fonts.semibold, fontSize: 16, letterSpacing: 0.2 },
  input: {
    fontFamily: fonts.body, fontSize: 16, color: colors.ink, backgroundColor: colors.card,
    borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(3),
  },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space(4), marginBottom: space(3) },
  tag: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  tagText: { fontFamily: fonts.semibold, fontSize: 12 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginRight: 5 },
  banner: { borderLeftWidth: 4, borderRadius: radius.md, padding: space(3.5), marginBottom: space(4) },
  empty: { paddingVertical: space(12), paddingHorizontal: space(4), alignItems: 'center' },
  stamp: { borderWidth: 2.5, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  stampText: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase' },
});

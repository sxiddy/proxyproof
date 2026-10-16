import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { colors } from '@/lib/theme';

// Expanding rings, used both for "broadcasting" and "listening".
function Ring({ progress, color }: { progress: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - progress.value),
    transform: [{ scale: 0.35 + progress.value * 0.65 }],
  }));
  return <Animated.View style={[StyleSheet.absoluteFill, styles.ring, { borderColor: color }, style]} />;
}

export function Radar({ size = 220, active = true, color = colors.accent, children }: { size?: number; active?: boolean; color?: string; children?: React.ReactNode }) {
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);

  useEffect(() => {
    const run = (v: SharedValue<number>, delay: number) => {
      v.value = 0;
      v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false));
    };
    if (active) {
      run(a, 0);
      run(b, 800);
      run(c, 1600);
    } else {
      a.value = withTiming(0);
      b.value = withTiming(0);
      c.value = withTiming(0);
    }
  }, [active, a, b, c]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[StyleSheet.absoluteFill, styles.ring, { borderColor: colors.line, borderStyle: 'dashed' }]} />
      {active ? (
        <>
          <Ring progress={a} color={color} />
          <Ring progress={b} color={color} />
          <Ring progress={c} color={color} />
        </>
      ) : null}
      <View style={[styles.core, { width: size * 0.42, height: size * 0.42, borderRadius: size }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderRadius: 999, borderWidth: 2 },
  core: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});

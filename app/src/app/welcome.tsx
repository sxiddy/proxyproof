import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Radar } from '@/components/radar';
import { Body, Button, H1, Italic, Label, Mono, Screen, Small } from '@/components/ui';
import { colors, space } from '@/lib/theme';

export default function Welcome() {
  return (
    <Screen
      footer={
        <View style={{ gap: space(2.5) }}>
          <Button title="Log in" onPress={() => router.push('/login')} />
          <Button title="Create an account" kind="outline" onPress={() => router.push('/signup')} />
        </View>
      }
    >
      <View style={styles.head}>
        <Label>ProxyProof</Label>
        <Pressable hitSlop={10} onPress={() => router.push('/settings')}>
          <Small>Server</Small>
        </Pressable>
      </View>

      <View style={{ alignItems: 'center', marginVertical: space(8) }}>
        <Radar size={200}>
          <Mono style={{ fontSize: 12, color: colors.muted }}>CS301</Mono>
        </Radar>
      </View>

      <H1>Attendance that{'\n'}takes itself.</H1>
      <Italic style={{ marginTop: space(3) }}>No roll call, no sign-in sheet, no "mark me too, bro".</Italic>

      <View style={{ marginTop: space(7), gap: space(4) }}>
        <Point n="1" text="Your organiser's phone sends out a Bluetooth signal with a code that changes every 5 seconds." />
        <Point n="2" text="Your phone hears it and checks you in. You don't need to tap anything." />
        <Point n="3" text="Screenshots, forwarded codes and a friend's phone won't work. You have to actually be in the room." />
      </View>
    </Screen>
  );
}

function Point({ n, text }: { n: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space(3) }}>
      <Mono style={{ color: colors.accent, width: 18 }}>{n}</Mono>
      <Body style={{ flex: 1 }}>{text}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: space(3) },
});

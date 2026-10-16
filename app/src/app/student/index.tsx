import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Radar } from '@/components/radar';
import { Banner, Body, Button, Card, Empty, H1, H2, H3, Label, Meter, Mono, Screen, Small, Stamp, Tag } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { bleAvailable, requestBlePermissions, useBluetoothState, useScanner } from '@/lib/ble';
import { useAutoCheckin, type Marked } from '@/lib/checkin';
import { firstName, greeting, timeOf } from '@/lib/format';
import { useSocketEvents } from '@/lib/socket';
import { colors, space } from '@/lib/theme';

type Course = { id: string; name: string; code: string; organiser: string; attended: number; total: number; percentage: number | null; liveSessionId: string | null };

export default function StudentHome() {
  const { user, deviceStatus, refresh } = useAuth();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [marked, setMarked] = useState<Marked | null>(null);
  const bt = useBluetoothState();

  const load = useCallback(async () => {
    try {
      const res = await api<{ courses: Course[] }>('/courses');
      setCourses(res.courses);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    requestBlePermissions().then(setPermission).catch(() => setPermission(false));
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  const { state, onBeacon, tick, reset } = useAutoCheckin(user?.id, (m) => {
    setMarked(m);
    load();
  });

  const canScan = bleAvailable && permission === true && bt === 'on' && deviceStatus === 'active' && foreground;
  const scan = useScanner(canScan, onBeacon);

  useEffect(() => {
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [tick]);

  useSocketEvents({
    marked: (p) => { setMarked({ sessionId: p.sessionId, courseName: p.courseName, markedAt: new Date().toISOString(), method: p.method }); load(); },
    unmarked: (p) => { setMarked((m) => (m?.sessionId === p.sessionId ? null : m)); load(); },
    device: () => { refresh().catch(() => {}); reset(); },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), refresh().catch(() => {})]);
    setRefreshing(false);
  };

  const live = courses?.filter((c) => c.liveSessionId) ?? [];
  const overall = courses && courses.reduce((a, c) => ({ at: a.at + c.attended, t: a.t + c.total }), { at: 0, t: 0 });

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Small>{greeting()},</Small>
          <H1>{user ? firstName(user.name) : ''}</H1>
        </View>
        <Pressable hitSlop={10} onPress={() => router.push('/settings')}><Small>Settings</Small></Pressable>
      </View>

      {deviceStatus === 'pending' ? (
        <Banner tone="warn" title="This phone is waiting for approval">
          You logged in on a new phone. An admin has to OK the switch before it can mark you present. Your old phone still works until then.
        </Banner>
      ) : null}
      {deviceStatus === 'none' ? (
        <Banner tone="danger" title="This phone isn't linked to you">
          Log out and back in on this phone to request a switch.
        </Banner>
      ) : null}
      {!bleAvailable ? (
        <Banner tone="danger" title="Bluetooth isn't available in this build">Install the ProxyProof APK to check in.</Banner>
      ) : permission === false ? (
        <Banner tone="warn" title="Bluetooth permission needed" action={
          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <Button small title="Allow" onPress={() => requestBlePermissions().then(setPermission)} />
            <Button small kind="outline" title="Open settings" onPress={() => Linking.openSettings()} />
          </View>
        }>
          ProxyProof only uses it to hear your organiser's signal. It doesn't track your location.
        </Banner>
      ) : bt === 'off' ? (
        <Banner tone="warn" title="Turn Bluetooth on">Swipe down and tap the Bluetooth tile. We'll pick it up from there.</Banner>
      ) : null}

      <StatusPanel state={state} canScan={canScan} marked={marked} liveCount={live.length} scanError={scan.error} />

      <View style={styles.sectionHead}>
        <Label>Your courses</Label>
        <Pressable hitSlop={10} onPress={() => router.push('/student/history')}><Small color={colors.accent}>Full history →</Small></Pressable>
      </View>

      {loadError && !courses ? <Banner tone="danger" title="Couldn't load your courses">{loadError}</Banner> : null}

      {overall && overall.t > 0 ? (
        <Card style={{ backgroundColor: colors.ink, borderColor: colors.ink }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Small color={colors.line}>Overall</Small>
            <Mono style={{ color: colors.paper, fontSize: 13 }}>{overall.at}/{overall.t} sessions</Mono>
          </View>
          <H2 style={{ color: colors.paper, fontSize: 34, lineHeight: 40, marginVertical: 4 }}>{Math.round((overall.at / overall.t) * 100)}%</H2>
          <Meter value={Math.round((overall.at / overall.t) * 100)} height={6} />
        </Card>
      ) : null}

      {courses?.length === 0 ? (
        <Empty title="No courses yet.">Ask your organiser for the 6-letter join code and add it below.</Empty>
      ) : null}

      {courses?.map((c) => (
        <Card key={c.id} onPress={() => router.push({ pathname: '/student/course/[id]', params: { id: c.id } })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Mono style={{ color: colors.muted, fontSize: 12 }}>{c.code}</Mono>
            {c.liveSessionId ? <Tag tone="live" text="Session on now" /> : null}
          </View>
          <H3 style={{ marginTop: 4 }}>{c.name}</H3>
          <Small>{c.organiser}</Small>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(3) }}>
            <View style={{ flex: 1 }}><Meter value={c.percentage} /></View>
            <Mono style={{ fontSize: 13 }}>{c.percentage == null ? '—' : `${c.percentage}%`}</Mono>
          </View>
        </Card>
      ))}

      <Button title="Join a course" kind="outline" onPress={() => router.push('/student/join')} style={{ marginTop: space(2) }} />
    </Screen>
  );
}

function StatusPanel({ state, canScan, marked, liveCount, scanError }: {
  state: ReturnType<typeof useAutoCheckin>['state']; canScan: boolean; marked: Marked | null; liveCount: number; scanError: string | null;
}) {
  let center = <Mono style={{ color: colors.muted, fontSize: 11 }}>{canScan ? 'listening' : 'paused'}</Mono>;
  let title = canScan ? 'Listening for your class' : 'Not listening right now';
  let body = canScan
    ? liveCount
      ? 'A session is running. Stay in the room with the app open and you\'ll be marked in a few seconds.'
      : "Keep this screen open when class starts. You don't have to tap anything."
    : 'Sort out the note above and this starts on its own.';
  let color: string = colors.accent;

  if (state.phase === 'hearing' || state.phase === 'checking') {
    title = state.phase === 'checking' ? 'Checking you in…' : 'Found a session nearby';
    body = 'Hold on a second while we get a steady signal.';
    center = <Signal rssi={state.rssi} />;
  } else if (state.phase === 'retry') {
    title = state.code === 'too_far' ? 'Move a little closer' : 'Almost there';
    body = state.message;
    color = colors.warn;
    center = <Signal rssi={state.rssi} />;
  } else if (state.phase === 'blocked') {
    title = "Can't check you in";
    body = state.message;
    color = colors.danger;
  }

  if (marked && state.phase !== 'blocked') {
    return (
      <Card style={[styles.panel, { borderColor: colors.ok }]}>
        <Stamp size={1.3} />
        <H2 style={{ marginTop: space(5) }}>You're in.</H2>
        <Body>{marked.courseName} · marked at {timeOf(marked.markedAt)}{marked.method === 'manual' ? ' by your organiser' : ''}.</Body>
        <Small style={{ marginTop: space(2) }}>You can put your phone away now.</Small>
      </Card>
    );
  }

  return (
    <Card style={styles.panel}>
      <View style={{ alignItems: 'center', marginBottom: space(4) }}>
        <Radar size={170} active={canScan && state.phase !== 'blocked'} color={color}>{center}</Radar>
      </View>
      <H2 center>{title}</H2>
      <Body center style={{ marginTop: space(1.5) }}>{scanError ?? body}</Body>
    </Card>
  );
}

/** Four little bars, like the phone's signal icon. */
function Signal({ rssi }: { rssi: number }) {
  const bars = rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 22 }}>
        {[1, 2, 3, 4].map((b) => (
          <View key={b} style={{ width: 5, height: 5 + b * 4, borderRadius: 1, backgroundColor: b <= bars ? colors.ink : colors.line }} />
        ))}
      </View>
      <Mono style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>{rssi} dBm</Mono>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: space(3), marginBottom: space(5) },
  panel: { paddingVertical: space(6), paddingHorizontal: space(5), marginBottom: space(6) },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(3) },
});

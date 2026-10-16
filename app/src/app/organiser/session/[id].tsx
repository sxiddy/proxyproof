import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Chips, RANGE_OPTIONS } from '@/components/chips';
import { Radar } from '@/components/radar';
import { Banner, Body, Button, Card, H1, H2, H3, Label, Loading, Mono, Rule, Screen, Small, Stamp, Tag } from '@/components/ui';
import { api, errorText, serverNow, syncClock } from '@/lib/api';
import { bleAvailable, requestBlePermissions, useBluetoothState, useBroadcast } from '@/lib/ble';
import { shareCsv } from '@/lib/export';
import { countdown, timeOf, when } from '@/lib/format';
import { useSocketEvents } from '@/lib/socket';
import { colors, space } from '@/lib/theme';

type Entry = { id: string; name: string; rollNo: string | null; present: boolean; method: 'ble' | 'manual' | null; markedAt: string | null; rssi: number | null };
type Attempt = { id: string; studentId: string; name: string; reason: string; rssi: number | null; at: string };
type Session = {
  id: string; courseId: string; courseName: string; courseCode: string; startedAt: string; endsAt: string; closedAt: string | null;
  live: boolean; rssiThreshold: number; beacon: { code: number; secret: string; windowSeconds: number } | null;
};

const REASON_LABEL: Record<string, string> = {
  stale_token: 'used an expired code',
  bad_signature: "tried from a phone that isn't theirs",
  too_far: 'was too far away',
  device_used: 'used a phone that already marked someone',
  device_pending: 'is on an unapproved phone',
  device_not_bound: 'has no linked phone',
  stale_request: 'has a wrong phone clock',
};

function KeepAwake() {
  useKeepAwake();
  return null;
}

export default function LiveSession() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [roster, setRoster] = useState<Entry[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [permission, setPermission] = useState<boolean | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [busy, setBusy] = useState<string | null>(null);
  const [showAbsent, setShowAbsent] = useState(true);
  const bt = useBluetoothState();

  const load = useCallback(async () => {
    try {
      const sentAt = Date.now();
      const res = await api<{ session: Session; roster: Entry[]; attempts: Attempt[]; serverTime: number }>(`/sessions/${id}`);
      syncClock(res.serverTime, sentAt, Date.now());
      setSession(res.session);
      setRoster(res.roster);
      setAttempts(res.attempts);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    const sub = AppState.addEventListener('change', (s) => {
      setForeground(s === 'active');
      if (s === 'active') load(); // catch up on anything missed while backgrounded
    });
    return () => { clearInterval(t); sub.remove(); };
  }, [load]);

  const endsAt = session ? new Date(session.endsAt).getTime() : 0;
  const remaining = endsAt - serverNow();
  const live = !!session && !session.closedAt && remaining > 0;

  useEffect(() => {
    if (live && permission === null) requestBlePermissions().then(setPermission).catch(() => setPermission(false));
  }, [live, permission]);

  // When the timer hits zero, refresh so the screen shows the closed state.
  useEffect(() => {
    if (session && !session.closedAt && remaining <= 0) {
      const t = setTimeout(load, 1500);
      return () => clearTimeout(t);
    }
  }, [session, remaining <= 0, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const broadcasting = live && permission === true && bt === 'on' && foreground && bleAvailable;
  const { token, error: bleError, nextChangeAt } = useBroadcast(session?.beacon ?? null, broadcasting);

  useSocketEvents({
    mark: (e: Entry) => setRoster((r) => upsert(r, e)),
    unmark: (e: { id: string }) => setRoster((r) => r.map((x) => (x.id === e.id ? { ...x, present: false, method: null, markedAt: null, rssi: null } : x))),
    attempt: (a: Attempt) => setAttempts((list) => [a, ...list.filter((x) => x.id !== a.id)].slice(0, 30)),
    closed: () => load(),
  }, (s) => s.emit('watch', id));

  const present = useMemo(() => roster.filter((r) => r.present).sort((a, b) => +new Date(b.markedAt!) - +new Date(a.markedAt!)), [roster]);
  const absent = useMemo(() => roster.filter((r) => !r.present), [roster]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (e) { Alert.alert('That failed', errorText(e)); } finally { setBusy(null); }
  };

  const addManual = (e: Entry) => act(e.id, async () => {
    const res = await api<{ entry: Entry }>(`/sessions/${id}/attendance`, { body: { studentId: e.id } });
    setRoster((r) => upsert(r, res.entry));
  });

  const remove = (e: Entry) => Alert.alert(`Remove ${e.name}?`, 'They\'ll be marked absent for this session.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => act(e.id, async () => {
      await api(`/sessions/${id}/attendance/${e.id}`, { method: 'DELETE' });
      setRoster((r) => r.map((x) => (x.id === e.id ? { ...x, present: false, method: null, markedAt: null } : x)));
    }) },
  ]);

  const close = () => Alert.alert('Close this session?', 'Broadcasting stops and no one else can check in. You can still add people by hand afterwards.', [
    { text: 'Keep going', style: 'cancel' },
    { text: 'Close it', style: 'destructive', onPress: () => act('close', async () => { await api(`/sessions/${id}/close`, { body: {} }); await load(); }) },
  ]);

  const setRange = (v: number) => act('range', async () => {
    await api(`/sessions/${id}`, { method: 'PATCH', body: { rssiThreshold: v } });
    setSession((s) => (s ? { ...s, rssiThreshold: v } : s));
  });

  if (!session) {
    return <Screen><Back />{error ? <Banner tone="danger" title="Couldn't load the session">{error}</Banner> : <Loading />}</Screen>;
  }

  const windowMs = (session.beacon?.windowSeconds ?? 5) * 1000;
  const tokenProgress = token && nextChangeAt ? Math.max(0, Math.min(1, (nextChangeAt - now) / windowMs)) : 0;

  return (
    <Screen onRefresh={load}>
      {live ? <KeepAwake /> : null}
      <Back />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Mono style={{ color: colors.muted, fontSize: 13 }}>{session.courseCode}</Mono>
        {live ? <Tag tone="live" text="Live" /> : <Tag text="Closed" />}
      </View>
      <H1>{session.courseName}</H1>
      <Small>{when(session.startedAt)}</Small>

      {live ? (
        <>
          {!bleAvailable ? <Banner tone="danger" title="Bluetooth isn't available in this build">Install the APK on an Android phone to broadcast.</Banner> : null}
          {permission === false ? (
            <Banner tone="warn" title="Bluetooth permission needed" action={<Button small title="Allow" onPress={() => requestBlePermissions().then(setPermission)} />}>
              Without it your phone can't send the signal.
            </Banner>
          ) : null}
          {bt === 'off' ? <Banner tone="warn" title="Bluetooth is off">Turn it on and broadcasting starts again by itself.</Banner> : null}
          {bleError && bt === 'on' ? <Banner tone="danger" title="Broadcast problem">{bleError}</Banner> : null}

          <Card style={styles.broadcast}>
            <Radar size={190} active={broadcasting && !!token}>
              <Mono style={{ fontSize: 28, color: colors.ink }}>{countdown(remaining)}</Mono>
              <Small>left</Small>
            </Radar>
            <View style={{ width: '100%', marginTop: space(5) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Label>Code on air</Label>
                <Small>changes every {session.beacon?.windowSeconds ?? 5}s</Small>
              </View>
              <Mono style={styles.token}>{token ? token.toUpperCase().replace(/(.{4})/g, '$1 ').trim() : broadcasting ? '···· ···· ···· ····' : 'not broadcasting'}</Mono>
              <View style={styles.tokenBar}><View style={[styles.tokenFill, { width: `${tokenProgress * 100}%` }]} /></View>
              <Small style={{ marginTop: space(2) }}>
                {broadcasting ? 'Leave this screen open on the desk. The screen stays on while the session runs.' : 'Paused. Bring the app back to the front to keep broadcasting.'}
              </Small>
            </View>
          </Card>

          <Label style={{ marginBottom: space(2) }}>Room size (signal cut-off {session.rssiThreshold} dBm)</Label>
          <Chips value={session.rssiThreshold} onChange={setRange} options={RANGE_OPTIONS} />
        </>
      ) : (
        <Card style={{ marginTop: space(5), alignItems: 'flex-start' }}>
          <Stamp text="Closed" color={colors.inkSoft} />
          <H2 style={{ marginTop: space(4) }}>{present.length} of {roster.length} were here.</H2>
          <Small>Ended {session.closedAt ? timeOf(session.closedAt) : ''}. You can still fix the list below.</Small>
        </Card>
      )}

      <View style={styles.counter}>
        <View>
          <Mono style={{ fontSize: 44, color: colors.ok }}>{present.length}</Mono>
          <Small>present</Small>
        </View>
        <Mono style={{ fontSize: 28, color: colors.line }}>/</Mono>
        <View>
          <Mono style={{ fontSize: 44, color: colors.ink }}>{roster.length}</Mono>
          <Small>enrolled</Small>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          {attempts.length ? <Tag tone="danger" text={`${attempts.length} blocked`} /> : null}
        </View>
      </View>

      <Label style={{ marginTop: space(5), marginBottom: space(1) }}>Marked present</Label>
      {present.length === 0 ? <Body style={{ paddingVertical: space(3) }}>Nobody yet. Phones nearby usually show up within ten seconds.</Body> : null}
      {present.map((e) => (
        <View key={e.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Body style={{ color: colors.ink }}>{e.name}</Body>
            <Small>
              {timeOf(e.markedAt!)} · {e.method === 'manual' ? 'added by you' : `Bluetooth${e.rssi != null ? `, ${e.rssi} dBm` : ''}`}
              {e.rollNo ? ` · ${e.rollNo}` : ''}
            </Small>
          </View>
          <Button small kind="ghost" title="Remove" onPress={() => remove(e)} loading={busy === e.id} />
        </View>
      ))}

      <Pressable onPress={() => setShowAbsent((v) => !v)} style={{ marginTop: space(5), marginBottom: space(1) }}>
        <Label>Not marked ({absent.length}) {showAbsent ? '▾' : '▸'}</Label>
      </Pressable>
      {showAbsent && absent.map((e) => (
        <View key={e.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Body style={{ color: colors.inkSoft }}>{e.name}</Body>
            {e.rollNo ? <Small>{e.rollNo}</Small> : null}
          </View>
          <Button small kind="outline" title="Mark present" onPress={() => addManual(e)} loading={busy === e.id} />
        </View>
      ))}

      {attempts.length ? (
        <>
          <Label style={{ marginTop: space(6), marginBottom: space(1) }}>Blocked attempts</Label>
          <Small style={{ marginBottom: space(2) }}>Check-ins the server turned down. Worth a look if one name keeps showing up.</Small>
          {attempts.slice(0, 12).map((a) => (
            <View key={a.id} style={styles.row}>
              <Mono style={{ fontSize: 12, color: colors.muted, width: 64 }}>{timeOf(a.at)}</Mono>
              <Body style={{ flex: 1, fontSize: 14 }}><H3 style={{ fontSize: 14 }}>{a.name}</H3> {REASON_LABEL[a.reason] ?? a.reason}</Body>
            </View>
          ))}
        </>
      ) : null}

      <Rule />
      <View style={{ gap: space(2.5) }}>
        {live ? <Button title="Close session now" kind="danger" onPress={close} loading={busy === 'close'} /> : null}
        <Button title="Export this session (CSV)" kind="outline" loading={busy === 'csv'}
          onPress={() => act('csv', () => shareCsv(`/sessions/${id}/export.csv`, `${session.courseCode}-${session.startedAt.slice(0, 10)}.csv`))} />
      </View>
    </Screen>
  );
}

function upsert(list: Entry[], e: Entry) {
  return list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [e, ...list];
}

function Back() {
  return (
    <View style={{ paddingVertical: space(3), marginBottom: space(2) }}>
      <Pressable hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace('/organiser'))}>
        <Body>← Back</Body>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  broadcast: { alignItems: 'center', marginTop: space(5), paddingVertical: space(6), marginBottom: space(5) },
  token: { fontSize: 22, letterSpacing: 2, color: colors.accent, marginTop: space(2) },
  tokenBar: { height: 3, backgroundColor: colors.sunk, borderRadius: 2, marginTop: space(2), overflow: 'hidden' },
  tokenFill: { height: '100%', backgroundColor: colors.accent },
  counter: { flexDirection: 'row', alignItems: 'flex-end', gap: space(3), marginTop: space(6) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: colors.line },
});

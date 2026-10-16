import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Chips, RANGE_OPTIONS } from '@/components/chips';
import { Radar } from '@/components/radar';
import { Banner, Body, Button, Card, H1, H2, H3, Label, Loading, Mono, Rule, Screen, Small, Stamp, Tag } from '@/components/ui';
import { api, errorText, serverNow, syncClock } from '@/lib/api';
import { bleAvailable, canAdvertise, requestBlePermissions, useBluetoothState, useBroadcast, useScanner } from '@/lib/ble';
import { shareCsv } from '@/lib/export';
import { countdown, timeOf, when } from '@/lib/format';
import { useSocketEvents } from '@/lib/socket';
import { colors, fonts, space } from '@/lib/theme';
import { decodeEcho, ECHO_PREFIX } from '@/lib/token';

type Entry = { id: string; name: string; rollNo: string | null; present: boolean; method: 'ble' | 'manual' | null; markedAt: string | null; rssi: number | null; heard?: boolean };
type Attempt = { id: string; studentId: string; name: string; reason: string; rssi: number | null; at: string; count: number };
type Session = {
  id: string; courseId: string; courseName: string; courseCode: string; startedAt: string; endsAt: string; closedAt: string | null;
  live: boolean; rssiThreshold: number; beacon: { code: number; secret: string; windowSeconds: number } | null;
};

// Worded gently where it's usually innocent (edge of the room, bad timing).
const REASON_LABEL: Record<string, string> = {
  stale_token: 'sent an expired code (often just timing)',
  bad_signature: "tried from a phone that isn't theirs",
  too_far: 'was out of range',
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
  const [projector, setProjector] = useState(false);
  const echoes = useRef(new Map<string, number>());
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

  // On Android 11 and older, advertising needs no runtime permission and works with Location off;
  // only hearing the students' echoes needs both.
  const legacy = Platform.OS === 'android' && Number(Platform.Version) < 31;
  const radioOn = bt === 'on' || bt === 'location_off';
  const broadcasting = live && (permission === true || legacy) && radioOn && foreground && bleAvailable;
  const hearing = broadcasting && permission === true && bt === 'on';
  const { token, error: bleError, nextChangeAt } = useBroadcast(session?.beacon ?? null, broadcasting);
  const cantBroadcast = live && bleAvailable && radioOn && (permission === true || legacy) && !canAdvertise();

  // Listen for students' phones answering back, and tell the server which ones we heard.
  useScanner(hearing, ECHO_PREFIX, (e) => {
    const echo = decodeEcho(e.payload);
    if (echo) echoes.current.set(echo, Date.now());
  });
  useEffect(() => {
    if (!broadcasting) return;
    const t = setInterval(() => {
      const cutoff = Date.now() - 15_000;
      const recent = [...echoes.current].filter(([, at]) => at > cutoff).map(([e]) => e);
      echoes.current = new Map([...echoes.current].filter(([, at]) => at > cutoff));
      if (recent.length) api(`/sessions/${id}/heard`, { body: { echoes: recent.slice(0, 300) } }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [broadcasting, id]);

  // Backing out stops the beacon, so make sure that's on purpose.
  usePreventRemove(live, ({ repeat }) => {
    Alert.alert('Leave the live screen?', "Broadcasting pauses until you come back. The session itself keeps running.", [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: repeat },
    ]);
  });

  // Students can join the course mid-session; reload the roster when one we don't know shows up.
  const rosterIds = useRef(new Set<string>());
  useEffect(() => { rosterIds.current = new Set(roster.map((x) => x.id)); }, [roster]);

  useSocketEvents({
    mark: (e: Entry) => setRoster((r) => upsert(r, e)),
    unmark: (e: { id: string }) => setRoster((r) => r.map((x) => (x.id === e.id ? { ...x, present: false, method: null, markedAt: null, rssi: null } : x))),
    attempt: (a: Attempt) => {
      setAttempts((list) => [a, ...list.filter((x) => x.id !== a.id)].slice(0, 30));
      if (!rosterIds.current.has(a.studentId)) load();
    },
    heard: (e: { id: string }) => setRoster((r) => r.map((x) => (x.id === e.id ? { ...x, heard: true } : x))),
    closed: () => load(),
  }, (s) => {
    // Re-join the room and catch up on anything that happened while disconnected.
    s.emit('watch', id);
    load();
  });

  const present = useMemo(() => roster.filter((r) => r.present).sort((a, b) => +new Date(b.markedAt!) - +new Date(a.markedAt!)), [roster]);
  const absent = useMemo(() => roster.filter((r) => !r.present), [roster]);
  const flagged = useMemo(() => {
    const by = new Map<string, { name: string; total: number; reasons: string[]; at: string }>();
    for (const a of attempts) {
      const g = by.get(a.studentId) ?? { name: a.name, total: 0, reasons: [], at: a.at };
      g.total += a.count ?? 1;
      g.reasons.push(REASON_LABEL[a.reason] ?? a.reason);
      if (a.at > g.at) g.at = a.at;
      by.set(a.studentId, g);
    }
    return [...by.entries()].sort((x, y) => (x[1].at < y[1].at ? 1 : -1));
  }, [attempts]);

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
          {!bleAvailable ? <Banner tone="warn" title="Browser demo">Browsers can't send Bluetooth, so nothing is broadcast here. Use "Mark present" below, or install the Android app to see automatic check-ins.</Banner> : null}
          {bleAvailable && permission === false ? (
            <Banner tone="warn" title="Bluetooth permission needed" action={<Button small title="Allow" onPress={() => requestBlePermissions().then(setPermission)} />}>
              Without it your phone can't send the signal.
            </Banner>
          ) : null}
          {bt === 'off' ? <Banner tone="warn" title="Bluetooth is off">Turn it on and broadcasting starts again by itself.</Banner> : null}
          {bleError && bt === 'on' ? <Banner tone="danger" title="Broadcast problem">{bleError}</Banner> : null}
          {cantBroadcast ? <Banner tone="danger" title="This phone can't broadcast">Its Bluetooth chip doesn't support advertising. Use another phone, or the laptop beacon in the README. You can still mark people by hand.</Banner> : null}
          {bt === 'location_off' ? <Banner tone="warn" title="Turn Location on">On this Android version the app can't hear students' phones while Location is off.</Banner> : null}

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
                {broadcasting ? 'Leave this screen open on the desk. The screen stays on while the session runs.' : !bleAvailable ? "The browser demo can't broadcast. The Android app does this part." : 'Paused. Bring the app back to the front to keep broadcasting.'}
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
          {flagged.length ? <Tag tone="danger" text={`${flagged.length} flagged`} /> : null}
          {live ? <Button small kind="outline" title="Projector view" onPress={() => setProjector(true)} style={{ marginTop: space(2) }} /> : null}
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
            {e.method === 'ble' ? (
              <Small color={e.heard ? colors.ok : colors.muted} style={{ marginTop: 2 }}>
                {e.heard ? '✓ Your phone heard theirs' : live ? 'Waiting to hear their phone…' : 'Not heard by your phone'}
              </Small>
            ) : null}
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

      {flagged.length ? (
        <>
          <Label style={{ marginTop: space(6), marginBottom: space(1) }}>Turned away</Label>
          <Small style={{ marginBottom: space(2) }}>Check-ins the server refused. "Out of range" is usually just someone at the back. Look twice at anything else.</Small>
          {flagged.slice(0, 15).map(([sid, g]) => (
            <View key={sid} style={styles.row}>
              <View style={{ flex: 1 }}>
                <H3 style={{ fontSize: 14 }}>{g.name}</H3>
                <Small>{[...new Set(g.reasons)].join(' · ')}</Small>
              </View>
              <Mono style={{ fontSize: 12, color: colors.muted }}>{g.total > 1 ? `${g.total}× · ` : ''}{timeOf(g.at)}</Mono>
            </View>
          ))}
        </>
      ) : null}

      <Modal visible={projector && live} animationType="fade" onRequestClose={() => setProjector(false)} statusBarTranslucent>
        <Pressable style={styles.projector} onPress={() => setProjector(false)} accessibilityLabel="Close projector view">
          <Mono style={{ color: colors.line, fontSize: 16 }}>{session.courseCode} · {countdown(remaining)} left</Mono>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginVertical: space(4) }}>
            <Mono style={{ color: colors.paper, fontSize: 120, lineHeight: 130 }}>{present.length}</Mono>
            <Mono style={{ color: colors.muted, fontSize: 48 }}> / {roster.length}</Mono>
          </View>
          <Body style={{ color: colors.line, fontFamily: fonts.displayItalic, fontSize: 22 }}>are in. Keep ProxyProof open if you aren't yet.</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(8), justifyContent: 'center' }}>
            {present.slice(0, 18).map((e) => (
              <View key={e.id} style={styles.slip}><Body style={{ color: colors.ink, fontSize: 14 }}>{e.name}</Body></View>
            ))}
          </View>
          <Small style={{ color: colors.muted, marginTop: space(8) }}>Tap anywhere to go back</Small>
        </Pressable>
      </Modal>

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
  tokenFill: { height: '100%', backgroundColor: colors.signal },
  counter: { flexDirection: 'row', alignItems: 'flex-end', gap: space(3), marginTop: space(6) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: colors.line },
  projector: { flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', padding: space(8) },
  // Names land like little paper slips pinned to the board.
  slip: { backgroundColor: colors.paper, paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: 3, transform: [{ rotate: '-1.5deg' }] },
});

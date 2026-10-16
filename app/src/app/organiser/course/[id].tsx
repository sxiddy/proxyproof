import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';
import { Chips, RANGE_OPTIONS } from '@/components/chips';
import { Banner, Body, Button, Card, Empty, H1, H3, Label, Loading, Meter, Mono, Rule, Screen, Small, Tag } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { shareCsv } from '@/lib/export';
import { when } from '@/lib/format';
import { colors, space } from '@/lib/theme';

type Detail = {
  course: { id: string; name: string; code: string; joinCode: string };
  students: { id: string; name: string; email: string; rollNo: string | null; attended: number; total: number; percentage: number | null }[];
  sessions: { id: string; startedAt: string; endsAt: string; closedAt: string | null; live: boolean; present: number }[];
};

export default function OrganiserCourse() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(5);
  const [range, setRange] = useState(-75);
  const [starting, setStarting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<'sessions' | 'students'>('sessions');

  const load = useCallback(async () => {
    try {
      setData(await api<Detail>(`/courses/${id}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const live = data?.sessions.find((s) => s.live);

  const start = async () => {
    setStarting(true);
    try {
      const { session } = await api(`/courses/${id}/sessions`, { body: { durationMinutes: minutes, rssiThreshold: range } });
      router.push({ pathname: '/organiser/session/[id]', params: { id: session.id } });
    } catch (e) {
      Alert.alert("Couldn't start the session", errorText(e));
      load();
    } finally {
      setStarting(false);
    }
  };

  const exportAll = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await shareCsv(`/courses/${id}/export.csv`, `${data.course.code}-attendance.csv`);
    } catch (e) {
      Alert.alert('Export failed', errorText(e));
    } finally {
      setExporting(false);
    }
  };

  const removeStudent = (s: Detail['students'][number]) => {
    Alert.alert(`Remove ${s.name}?`, 'They drop out of this course. Their past attendance stays in old exports.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await api(`/courses/${id}/students/${s.id}`, { method: 'DELETE' }); load(); } catch (e) { Alert.alert('Failed', errorText(e)); }
      } },
    ]);
  };

  if (!data) {
    return (
      <Screen>
        <TopBarLite />
        {error ? <Banner tone="danger" title="Couldn't load this course">{error}</Banner> : <Loading />}
      </Screen>
    );
  }

  return (
    <Screen onRefresh={load}>
      <TopBarLite />
      <Mono style={{ color: colors.muted, fontSize: 13 }}>{data.course.code}</Mono>
      <H1>{data.course.name}</H1>

      <Pressable onPress={() => Share.share({ message: `Join ${data.course.name} on ProxyProof with code ${data.course.joinCode}` })}>
        <View style={styles.joinBox}>
          <View>
            <Label>Join code</Label>
            <Mono style={{ fontSize: 28, letterSpacing: 6, marginTop: 2 }}>{data.course.joinCode}</Mono>
          </View>
          <Small color={colors.accent}>Share</Small>
        </View>
      </Pressable>

      {live ? (
        <Card style={{ borderColor: colors.accent, borderWidth: 1.5 }}>
          <Tag tone="live" text="Session running" />
          <H3 style={{ marginTop: space(2) }}>{live.present} marked so far</H3>
          <Button title="Open live view" kind="accent" style={{ marginTop: space(3) }}
            onPress={() => router.push({ pathname: '/organiser/session/[id]', params: { id: live.id } })} />
        </Card>
      ) : (
        <Card>
          <H3>Start a session</H3>
          <Small style={{ marginBottom: space(4) }}>Your phone starts broadcasting straight away. Keep it out on the desk at the front.</Small>
          <Label style={{ marginBottom: space(2) }}>How long</Label>
          <Chips value={minutes} onChange={setMinutes} options={[2, 5, 10, 15].map((m) => ({ value: m, label: `${m} min` }))} />
          <Label style={{ marginTop: space(4), marginBottom: space(2) }}>Room size</Label>
          <Chips value={range} onChange={setRange} options={RANGE_OPTIONS} />
          <Button title={`Start ${minutes}-minute session`} kind="accent" onPress={start} loading={starting} style={{ marginTop: space(5) }}
            disabled={data.students.length === 0} />
          {data.students.length === 0 ? <Small style={{ marginTop: space(2) }}>Nobody has joined yet. Share the code first.</Small> : null}
        </Card>
      )}

      <View style={styles.tabs}>
        {(['sessions', 'students'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <H3 style={{ color: tab === t ? colors.ink : colors.muted, fontSize: 15 }}>
              {t === 'sessions' ? `Sessions (${data.sessions.length})` : `Students (${data.students.length})`}
            </H3>
          </Pressable>
        ))}
      </View>

      {tab === 'sessions' ? (
        data.sessions.length === 0 ? <Empty title="No sessions yet." /> : data.sessions.map((s) => (
          <Pressable key={s.id} onPress={() => router.push({ pathname: '/organiser/session/[id]', params: { id: s.id } })} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Body style={{ color: colors.ink }}>{when(s.startedAt)}</Body>
              <Small>{s.present} of {data.students.length} present</Small>
            </View>
            {s.live ? <Tag tone="live" text="Live" /> : <Small>→</Small>}
          </Pressable>
        ))
      ) : data.students.length === 0 ? <Empty title="No students yet.">Share the join code above.</Empty> : data.students.map((s) => (
        <Pressable key={s.id} onLongPress={() => removeStudent(s)} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Body style={{ color: colors.ink }}>{s.name}</Body>
            <Small>{s.rollNo ?? s.email}</Small>
          </View>
          <View style={{ width: 90 }}>
            <Mono style={{ fontSize: 13, textAlign: 'right', marginBottom: 4 }}>{s.percentage == null ? '—' : `${s.percentage}%`}</Mono>
            <Meter value={s.percentage} height={5} />
          </View>
        </Pressable>
      ))}
      {tab === 'students' && data.students.length ? <Small style={{ marginTop: space(2) }}>Long-press a student to remove them.</Small> : null}

      <Rule />
      <Button title="Export full register (CSV)" kind="outline" onPress={exportAll} loading={exporting} disabled={!data.sessions.length} />
    </Screen>
  );
}

function TopBarLite() {
  return (
    <View style={{ paddingVertical: space(3), marginBottom: space(2) }}>
      <Pressable hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace('/organiser'))}>
        <Body>← Courses</Body>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  joinBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: space(5),
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.inkSoft, borderRadius: 12, padding: space(4),
  },
  tabs: { flexDirection: 'row', gap: space(5), marginTop: space(4), marginBottom: space(1), borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { paddingVertical: space(2.5), borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3.5), borderBottomWidth: 1, borderBottomColor: colors.line },
});

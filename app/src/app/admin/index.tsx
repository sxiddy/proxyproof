import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Banner, Body, Button, Card, Empty, H1, H3, Label, Loading, Mono, Screen, Small } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { when } from '@/lib/format';
import { colors, space } from '@/lib/theme';

type Request = {
  id: string; requestedAt: string; model: string | null;
  student: { id: string; name: string; email: string; rollNo: string | null };
  currentDevice: { model: string | null; since: string } | null;
};
type Overview = { students: number; organisers: number; courses: number; sessions: number; pending: number };

export default function AdminHome() {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([api<{ requests: Request[] }>('/admin/device-requests'), api<Overview>('/admin/overview')]);
      setRequests(r.requests);
      setOverview(o);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decide = (r: Request, approve: boolean) => {
    const go = async () => {
      setBusy(r.id);
      try {
        await api(`/admin/device-requests/${r.id}/${approve ? 'approve' : 'reject'}`, { body: {} });
        setRequests((list) => list?.filter((x) => x.id !== r.id) ?? null);
      } catch (e) {
        Alert.alert('That failed', errorText(e));
      } finally {
        setBusy(null);
      }
    };
    if (!approve) return go();
    Alert.alert(`Move ${r.student.name} to the new phone?`, 'Their old phone stops working for check-ins straight away.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: go },
    ]);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingTop: space(3), marginBottom: space(5) }}>
        <View style={{ flex: 1 }}>
          <Small>Admin</Small>
          <H1>Phone switches</H1>
        </View>
        <Pressable hitSlop={10} accessibilityRole="button" onPress={() => router.push('/settings')}><Small>Settings</Small></Pressable>
      </View>

      {overview ? (
        <View style={{ flexDirection: 'row', gap: space(2), marginBottom: space(6) }}>
          {[['students', overview.students], ['organisers', overview.organisers], ['courses', overview.courses], ['sessions', overview.sessions]].map(([k, v]) => (
            <View key={k} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: space(2.5) }}>
              <Mono style={{ fontSize: 20 }}>{v}</Mono>
              <Small style={{ fontSize: 11 }}>{k}</Small>
            </View>
          ))}
        </View>
      ) : null}

      <Body style={{ marginBottom: space(5) }}>
        Each student is locked to one phone. When someone logs in on a different one, it waits here. Approve it only if you're sure it's really them (a broken or new phone, say).
      </Body>

      {error ? <Banner tone="danger" title="Couldn't load requests">{error}</Banner> : null}
      {!requests && !error ? <Loading /> : null}
      {requests?.length === 0 ? <Empty title="Nothing waiting.">New phone requests will show up here.</Empty> : null}

      {requests?.map((r) => (
        <Card key={r.id}>
          <H3>{r.student.name}</H3>
          <Small>{r.student.rollNo ? `${r.student.rollNo} · ` : ''}{r.student.email}</Small>
          <View style={{ marginTop: space(3), gap: 4 }}>
            <Label>From</Label>
            <Body style={{ fontSize: 14 }}>{r.currentDevice ? `${r.currentDevice.model ?? 'Unknown phone'} (since ${when(r.currentDevice.since)})` : 'No phone linked'}</Body>
            <Label style={{ marginTop: space(2) }}>To</Label>
            <Body style={{ fontSize: 14 }}>{r.model ?? 'Unknown phone'} · asked {when(r.requestedAt)}</Body>
          </View>
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(4) }}>
            <Button small title="Approve" onPress={() => decide(r, true)} loading={busy === r.id} style={{ flex: 1 }} />
            <Button small kind="danger" title="Reject" onPress={() => decide(r, false)} disabled={busy === r.id} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

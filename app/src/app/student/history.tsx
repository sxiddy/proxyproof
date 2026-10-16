import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { AttendanceRow, type HistoryRow } from '@/components/attendance-row';
import { Banner, Body, Empty, H1, Label, Loading, Meter, Mono, Screen, TopBar } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { colors, space } from '@/lib/theme';

type History = { attended: number; total: number; percentage: number | null; sessions: HistoryRow[] };

export default function StudentHistory() {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<History>('/me/history'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <TopBar />
      <H1>Your attendance</H1>
      {error ? <Banner tone="danger" title="Couldn't load history">{error}</Banner> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(3), marginTop: space(4) }}>
            <Mono style={{ fontSize: 44, color: colors.ink }}>{data.percentage == null ? '—' : `${data.percentage}%`}</Mono>
            <Body>{data.attended} of {data.total} sessions</Body>
          </View>
          <View style={{ marginTop: space(3), marginBottom: space(2) }}><Meter value={data.percentage} height={10} /></View>
          <Body style={{ fontSize: 13, marginBottom: space(6) }}>
            {data.percentage == null ? 'Nothing counted yet.'
              : data.percentage >= 75 ? "You're above the usual 75% line. Keep it up."
                : `You're below the usual 75% line. You'd need ${needed(data.attended, data.total)} more in a row to get back over it.`}
          </Body>
          <Label style={{ marginBottom: space(1) }}>Every session</Label>
          {data.sessions.length === 0 ? <Empty title="Nothing here yet.">Sessions you're part of will show up here once they end.</Empty> : null}
          {data.sessions.map((s) => <AttendanceRow key={s.id} row={s} showCourse />)}
        </>
      ) : null}
    </Screen>
  );
}

/** How many consecutive sessions it takes to climb back to 75%. */
function needed(attended: number, total: number) {
  let n = 0;
  while ((attended + n) / (total + n) < 0.75 && n < 1000) n++;
  return n;
}

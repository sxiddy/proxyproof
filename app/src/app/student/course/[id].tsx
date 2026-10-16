import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { AttendanceRow, type HistoryRow } from '@/components/attendance-row';
import { Banner, Body, Empty, H1, Label, Loading, Meter, Mono, Screen, Small, TopBar } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { colors, space } from '@/lib/theme';

type Detail = {
  course: { id: string; name: string; code: string; organiser: string };
  attended: number; total: number; percentage: number | null; sessions: HistoryRow[];
};

export default function StudentCourse() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Detail>(`/courses/${id}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <TopBar />
      {error ? <Banner tone="danger" title="Couldn't load this course">{error}</Banner> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <>
          <Mono style={{ color: colors.muted, fontSize: 13 }}>{data.course.code}</Mono>
          <H1>{data.course.name}</H1>
          <Small>{data.course.organiser}</Small>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(3), marginTop: space(6) }}>
            <Mono style={{ fontSize: 40, color: colors.ink }}>{data.percentage == null ? '—' : `${data.percentage}%`}</Mono>
            <Body>{data.attended} of {data.total}</Body>
          </View>
          <View style={{ marginVertical: space(3) }}><Meter value={data.percentage} height={10} /></View>
          <Label style={{ marginTop: space(4), marginBottom: space(1) }}>Sessions</Label>
          {data.sessions.length === 0 ? <Empty title="No sessions yet.">They'll appear here once your organiser runs one.</Empty> : null}
          {data.sessions.map((s) => <AttendanceRow key={s.id} row={s} />)}
        </>
      ) : null}
    </Screen>
  );
}

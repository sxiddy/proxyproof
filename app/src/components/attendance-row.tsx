import { StyleSheet, View } from 'react-native';
import { colors, space } from '@/lib/theme';
import { dayOf, timeOf } from '@/lib/format';
import { Body, Mono, Small, Tag } from './ui';

export type HistoryRow = {
  id: string; startedAt: string; status: 'present' | 'absent' | 'live';
  markedAt: string | null; method: 'ble' | 'manual' | null; courseCode?: string; courseName?: string;
};

export function AttendanceRow({ row, showCourse }: { row: HistoryRow; showCourse?: boolean }) {
  const tone = row.status === 'present' ? 'ok' : row.status === 'live' ? 'live' : 'danger';
  const label = row.status === 'present' ? 'Present' : row.status === 'live' ? 'Live now' : 'Absent';
  return (
    <View style={styles.row}>
      <View style={styles.date}>
        <Mono style={{ fontSize: 12, color: colors.muted }}>{dayOf(row.startedAt)}</Mono>
        <Small>{timeOf(row.startedAt)}</Small>
      </View>
      <View style={{ flex: 1 }}>
        {showCourse ? <Body style={{ color: colors.ink }} numberOfLines={1}>{row.courseName}</Body> : null}
        <Small>
          {row.status === 'present'
            ? row.method === 'manual' ? `Added by organiser` : `Checked in at ${timeOf(row.markedAt!)}`
            : row.status === 'live' ? 'Session is open' : 'Not marked'}
        </Small>
      </View>
      <Tag tone={tone} text={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: colors.line },
  date: { width: 92 },
});

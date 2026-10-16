import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Banner, Body, Button, Card, Empty, H1, H3, Label, Loading, Mono, Screen, Small, Tag } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { firstName, greeting } from '@/lib/format';
import { colors, space } from '@/lib/theme';

export type OrgCourse = { id: string; name: string; code: string; joinCode: string; students: number; sessions: number; liveSessionId: string | null };

export default function OrganiserHome() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<OrgCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCourses((await api<{ courses: OrgCourse[] }>('/courses')).courses);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
      footer={<Button title="New course" onPress={() => router.push('/organiser/new-course')} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingTop: space(3), marginBottom: space(6) }}>
        <View style={{ flex: 1 }}>
          <Small>{greeting()},</Small>
          <H1>{user ? firstName(user.name) : ''}</H1>
        </View>
        <Pressable hitSlop={10} onPress={() => router.push('/settings')}><Small>Settings</Small></Pressable>
      </View>

      <Label style={{ marginBottom: space(3) }}>Your courses</Label>
      {error ? <Banner tone="danger" title="Couldn't load courses">{error}</Banner> : null}
      {!courses && !error ? <Loading /> : null}
      {courses?.length === 0 ? (
        <Empty title="Nothing on the board yet.">Make a course, put its join code on the projector, and students add themselves.</Empty>
      ) : null}

      {courses?.map((c) => (
        <Card key={c.id} onPress={() => router.push({ pathname: '/organiser/course/[id]', params: { id: c.id } })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Mono style={{ color: colors.muted, fontSize: 12 }}>{c.code}</Mono>
            {c.liveSessionId ? <Tag tone="live" text="Live" /> : null}
          </View>
          <H3 style={{ marginTop: 4 }}>{c.name}</H3>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space(3) }}>
            <Body style={{ fontSize: 14 }}>{c.students} {c.students === 1 ? 'student' : 'students'} · {c.sessions} {c.sessions === 1 ? 'session' : 'sessions'}</Body>
            <Mono style={{ fontSize: 13, color: colors.accent }}>{c.joinCode}</Mono>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

import { router } from 'expo-router';
import { useState } from 'react';
import { Banner, Body, Button, Field, H1, Screen, TopBar } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { space } from '@/lib/theme';

export default function NewCourse() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { course } = await api('/courses', { body: { name: name.trim(), code: code.trim() } });
      router.replace({ pathname: '/organiser/course/[id]', params: { id: course.id } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar />
      <H1>New course</H1>
      <Body style={{ marginTop: space(2), marginBottom: space(6) }}>You'll get a join code to share with the class.</Body>
      {error ? <Banner tone="danger" title="Couldn't create it">{error}</Banner> : null}
      <Field label="Course name" value={name} onChangeText={setName} placeholder="Operating Systems" autoCapitalize="words" />
      <Field label="Short code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="CS301" autoCapitalize="characters" maxLength={16} />
      <Button title="Create course" onPress={submit} loading={busy} disabled={name.trim().length < 2 || code.trim().length < 2} />
    </Screen>
  );
}

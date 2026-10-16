import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { Banner, Body, Button, H1, Screen, TopBar } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { colors, fonts, radius, space } from '@/lib/theme';

export default function JoinCourse() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/courses/join', { body: { joinCode: code } });
      router.back();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar />
      <H1>Join a course</H1>
      <Body style={{ marginTop: space(2), marginBottom: space(6) }}>Your organiser has a 6-character code. It's usually up on the board on day one.</Body>
      {error ? <Banner tone="danger" title="That didn't work">{error}</Banner> : null}
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        placeholder="K7Q2MX"
        placeholderTextColor={colors.line}
        style={styles.code}
        onSubmitEditing={() => code.length === 6 && submit()}
      />
      <Button title="Join" onPress={submit} loading={busy} disabled={code.length !== 6} style={{ marginTop: space(6) }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: {
    fontFamily: fonts.mono, fontSize: 34, letterSpacing: 10, textAlign: 'center', color: colors.ink,
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space(4),
  },
});

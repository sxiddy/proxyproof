import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, Body, Button, Field, H1, Label, Screen, Small, TopBar } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, fonts, radius, space } from '@/lib/theme';

export default function Signup() {
  const { register } = useAuth();
  const [role, setRole] = useState<'student' | 'organiser'>('student');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (name.trim().length < 2) return setError('Tell us your name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('That email looks off.');
    if (password.length < 8) return setError('Password needs at least 8 characters.');
    if (role === 'organiser' && !code.trim()) return setError('Organisers need the staff code.');
    setBusy(true);
    setError(null);
    try {
      await register({
        name: name.trim(), email: email.trim(), password, role,
        rollNo: role === 'student' ? rollNo.trim() || undefined : undefined,
        organiserCode: role === 'organiser' ? code.trim() : undefined,
      });
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar />
      <H1>Make an account.</H1>
      <Body style={{ marginTop: space(2), marginBottom: space(6) }}>Takes about thirty seconds.</Body>

      <Label style={{ marginBottom: space(2) }}>I'm a</Label>
      <View style={styles.segment}>
        {(['student', 'organiser'] as const).map((r) => (
          <Pressable key={r} onPress={() => setRole(r)} style={[styles.seg, role === r && styles.segOn]} accessibilityRole="radio" accessibilityState={{ selected: role === r }}>
            <Text style={[styles.segText, role === r && { color: colors.paper }]}>{r === 'student' ? 'Student' : 'Organiser'}</Text>
          </Pressable>
        ))}
      </View>
      <Small style={{ marginBottom: space(5) }}>
        {role === 'student'
          ? "Sign up on the phone you'll bring to class. It gets linked to you, and switching later needs an admin's OK."
          : 'Organisers run sessions and see the live list. You need the staff code from your department.'}
      </Small>

      {error ? <Banner tone="danger" title="Not quite">{error}</Banner> : null}

      <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Ananya Iyer" />
      <Field label="College email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@college.edu" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry hint="8 characters or more" />
      {role === 'student' ? (
        <Field label="Roll number (optional)" value={rollNo} onChangeText={setRollNo} autoCapitalize="characters" placeholder="23BCE1042" />
      ) : (
        <Field label="Staff code" value={code} onChangeText={setCode} autoCapitalize="characters" />
      )}

      <View style={{ marginTop: space(2), gap: space(2) }}>
        <Button title={role === 'student' ? 'Create account and link this phone' : 'Create organiser account'} onPress={submit} loading={busy} />
        <Button title="Already have one? Log in" kind="ghost" onPress={() => router.replace('/login')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: radius.md, padding: 4, marginBottom: space(2.5) },
  seg: { flex: 1, paddingVertical: space(2.5), alignItems: 'center', borderRadius: radius.sm },
  segOn: { backgroundColor: colors.ink },
  segText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkSoft },
});

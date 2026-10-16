import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Banner, Body, Button, Field, H1, Screen, TopBar } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { space } from '@/lib/theme';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pw = useRef<any>(null);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Fill in both fields.');
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      if (router.canDismiss()) router.dismissAll();
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
      <H1>Welcome back.</H1>
      <Body style={{ marginTop: space(2), marginBottom: space(7) }}>
        Students: log in on your own phone. This phone becomes the one you're checked in with.
      </Body>

      {error ? <Banner tone="danger" title="Couldn't log you in">{error}</Banner> : null}

      <Field
        label="College email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
        keyboardType="email-address" returnKeyType="next" onSubmitEditing={() => pw.current?.focus()} placeholder="you@college.edu"
      />
      <Field
        ref={pw} label="Password" value={password} onChangeText={setPassword} secureTextEntry
        autoComplete="password" returnKeyType="go" onSubmitEditing={submit}
      />
      <View style={{ marginTop: space(2), gap: space(2) }}>
        <Button title="Log in" onPress={submit} loading={busy} />
        <Button title="New here? Create an account" kind="ghost" onPress={() => router.replace('/signup')} />
      </View>
    </Screen>
  );
}

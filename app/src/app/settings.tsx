import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Banner, Body, Button, Card, Field, H1, H3, Label, Mono, Rule, Screen, Small, TopBar } from '@/components/ui';
import { api, DEFAULT_API_URL, errorText, getApiUrl, setApiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { bleAvailable, useBluetoothState } from '@/lib/ble';
import { deviceInfo } from '@/lib/device';
import { space } from '@/lib/theme';

export default function Settings() {
  const { user, deviceStatus, logout } = useAuth();
  const [url, setUrl] = useState(getApiUrl());
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<{ model: string; publicKey: string } | null>(null);
  const bt = useBluetoothState();

  useEffect(() => { deviceInfo().then(setDevice).catch(() => {}); }, []);

  const save = async () => {
    setBusy(true);
    setCheck(null);
    const previous = getApiUrl();
    try {
      await setApiUrl(url);
      await api('/health', { timeoutMs: 8000 });
      setUrl(getApiUrl());
      setCheck({ ok: true, text: 'Connected. All good.' });
    } catch (e) {
      await setApiUrl(previous);
      setCheck({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar />
      <H1>Settings</H1>

      {user ? (
        <Card style={{ marginTop: space(5) }}>
          <Label>Signed in as</Label>
          <H3 style={{ marginTop: 4 }}>{user.name}</H3>
          <Small>{user.email} · {user.role}{user.rollNo ? ` · ${user.rollNo}` : ''}</Small>
          {user.role === 'student' ? (
            <Small style={{ marginTop: space(2) }}>
              This phone: {deviceStatus === 'active' ? 'linked to you' : deviceStatus === 'pending' ? 'waiting for admin approval' : 'not linked'}
            </Small>
          ) : null}
        </Card>
      ) : null}

      <Label style={{ marginTop: space(5), marginBottom: space(3) }}>This phone</Label>
      <Body>Model: {device?.model ?? '…'}</Body>
      <Body>Bluetooth: {!bleAvailable ? 'not available in this build' : bt === 'on' ? 'on' : bt === 'off' ? 'off' : bt === 'location_off' ? 'on, but Location is off' : 'not supported'}</Body>
      {device ? (
        <View style={{ marginTop: space(2) }}>
          <Small>Device fingerprint (handy if an admin asks)</Small>
          <Mono style={{ fontSize: 13 }}>{device.publicKey.slice(0, 4).toUpperCase()}-{device.publicKey.slice(-4).toUpperCase()}</Mono>
        </View>
      ) : null}

      <Rule />

      <Label style={{ marginBottom: space(3) }}>Server</Label>
      <Field
        label="API address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        hint={`Leave as is unless you're running your own server. Default: ${DEFAULT_API_URL}`}
      />
      {check ? <Banner tone={check.ok ? 'ok' : 'danger'} title={check.ok ? 'Saved' : "Couldn't connect"}>{check.text}</Banner> : null}
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button title="Save and test" onPress={save} loading={busy} style={{ flex: 1 }} />
        <Button title="Reset" kind="outline" onPress={() => setUrl(DEFAULT_API_URL)} />
      </View>

      {user ? (
        <>
          <Rule />
          <Button title="Log out" kind="danger" onPress={async () => { await logout(); router.replace('/welcome'); }} />
        </>
      ) : null}

      <Small center style={{ marginTop: space(8) }}>ProxyProof v{Constants.expoConfig?.version ?? '1.0.0'}</Small>
    </Screen>
  );
}

import { Fraunces_400Regular_Italic, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold } from '@expo-google-fonts/instrument-sans';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { colors, fonts } from '@/lib/theme';
import { ActivityIndicator, Text, View } from 'react-native';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const { ready, waking } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold, Fraunces_400Regular_Italic,
    InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold,
    JetBrainsMono_500Medium,
  });
  const done = ready && (fontsLoaded || !!fontError);

  useEffect(() => {
    if (done || waking) SplashScreen.hideAsync().catch(() => {});
  }, [done, waking]);

  if (!done) {
    if (!waking || !(fontsLoaded || fontError)) return null;
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <ActivityIndicator color={colors.signal} />
        <Text style={{ fontFamily: fonts.displayItalic, fontSize: 18, color: colors.ink, marginTop: 16, textAlign: 'center' }}>Waking the server up…</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginTop: 6, textAlign: 'center' }}>The free demo server naps when nobody's using it. Give it a few seconds.</Text>
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper }, animation: 'slide_from_right' }} />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

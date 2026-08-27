import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ImageBackground, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';
import { useBreakpoint } from '@/ui/useBreakpoint';

// Matías's own commissioned art (2026-08-10) — vertical for phone/portrait, horizontal for the
// 'wide' breakpoint, same pairing the rest of this app uses.
const BACKGROUND_VERTICAL = require('../../assets/images/login-background-vertical.png');
const BACKGROUND_HORIZONTAL = require('../../assets/images/login-background-horizontal.png');

// This app's other screens are data-dense (tables, forms) where a busy illustrated background
// would fight legibility — a dramatic backdrop earns its place only on this one screen, which is
// just a title and two fields. Deliberately not using the shared `Screen` wrapper (its own doc
// comment already anticipated this: "Revisit if Screen is ever used outside that nav shell —
// e.g. a future full-bleed login screen"): `Screen` paints an opaque flat surface, which would
// hide this art. The `ImageBackground` below is positioned absolute, top:0/right:0/bottom:0/
// left:0 — outside (before) the SafeAreaView, so it fills the entire screen content area
// including the top strip under the status bar (where `app/(auth)/_layout.tsx`'s
// `EnvironmentBadge` floats above it, `overlay`-styled with its own higher zIndex) — not just
// the area below the safe-area inset. The form content's own SafeAreaView, rendered after it in
// this same return, paints on top for readability.
export default function LoginScreen() {
  const { beginLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const breakpoint = useBreakpoint();

  // final-review Minor: bounds how long an abandoned login attempt's credentials sit in
  // AuthContext's in-memory ref (e.g. the operator typed a code, tapped "Volver", and never
  // returned) — clearing pending state the moment this screen is reached again is a natural,
  // no-extra-UI way to do it, distinct from the environment-switch clear above.
  useEffect(() => {
    beginLogin('', '');
  }, [beginLogin]);

  function handleSubmit() {
    beginLogin(username, password);
    router.push('/totp');
  }

  return (
    <View className="flex-1">
      <ImageBackground
        source={breakpoint === 'wide' ? BACKGROUND_HORIZONTAL : BACKGROUND_VERTICAL}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <View className="flex-1 bg-black/55" />
      </ImageBackground>
      <SafeAreaView edges={['bottom', 'left', 'right']} className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <View className="flex-1 items-center justify-center gap-6 px-8">
            {/* Unconditionally the light-on-dark token, not the usual `text-steel-light
                dark:text-night-steel-light` split — this screen's backdrop is the dark art
                image year-round, in both system light and dark mode, so the text needs the
                same fixed light color either way. */}
            <Text className="text-2xl text-night-steel-light" style={{ fontFamily: fonts.bold }}>
              Overlord
            </Text>
            <View className="w-full gap-4">
              <TextField
                label="Usuario"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                forceNight
              />
              <TextField
                label="Contraseña"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                forceNight
              />
            </View>
            <Button
              label="Ingresar"
              onPress={handleSubmit}
              disabled={username.length === 0 || password.length === 0}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

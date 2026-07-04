import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from '../api';
import { useAuth } from '../../App';
import { colors, shadow } from '../theme';

// Credentials are kept in the OS-encrypted keychain (Android Keystore / iOS
// Keychain) via expo-secure-store — never in plaintext storage.
const CRED_KEY = 'rsg_saved_credentials';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill any saved credentials on launch
  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(CRED_KEY);
        if (raw) {
          const c = JSON.parse(raw);
          setEmail(c.email || ''); setPassword(c.password || '');
          setBranchCode(c.branch_code || ''); setRemember(true);
        }
      } catch { /* keychain unavailable */ }
    })();
  }, []);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email, password, branch_code: branchCode || undefined } });
      // Save or clear credentials based on the toggle
      try {
        if (remember) await SecureStore.setItemAsync(CRED_KEY, JSON.stringify({ email, password, branch_code: branchCode }));
        else await SecureStore.deleteItemAsync(CRED_KEY);
      } catch { /* best effort */ }
      await login(d);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.surface, justifyContent: 'center', padding: 24 }}>
      <View style={[{ backgroundColor: '#fff', borderRadius: 18, padding: 26 }, shadow]}>
        <Image source={require('../../assets/rs-group-logo.jpg')} style={{ width: 84, height: 84, alignSelf: 'center', borderRadius: 14 }} resizeMode="contain" />
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.brandDark, textAlign: 'center', marginTop: 8 }}>RS Group Staff</Text>
        <Text style={{ color: colors.ink3, textAlign: 'center', marginBottom: 18, fontSize: 12 }}>Medical Shop Management</Text>
        {!!err && <Text style={{ color: colors.red, backgroundColor: '#fdecea', padding: 8, borderRadius: 8, marginBottom: 10 }}>{err}</Text>}
        <TextInput style={s.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <TextInput style={[s.input, { paddingRight: 64 }]} placeholder="Password" secureTextEntry={!showPw} value={password} onChangeText={setPassword} />
          <TouchableOpacity onPress={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 12, top: 12 }}>
            <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>{showPw ? 'HIDE' : 'SHOW'}</Text>
          </TouchableOpacity>
        </View>
        <TextInput style={s.input} placeholder="Branch code (optional, e.g. RSG-CHN)" autoCapitalize="characters" value={branchCode} onChangeText={setBranchCode} />

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Switch value={remember} onValueChange={setRemember} />
          <Text style={{ marginLeft: 8, color: colors.ink2, flex: 1 }}>Save password (encrypted on this device)</Text>
        </View>

        <TouchableOpacity style={{ backgroundColor: colors.brand, borderRadius: 10, padding: 14 }} onPress={submit} disabled={busy}>
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>{busy ? 'Signing in…' : 'Sign In'}</Text>
        </TouchableOpacity>
        <Text style={{ color: colors.ink3, textAlign: 'center', marginTop: 12, fontSize: 11 }}>
          Saved logins are stored in your phone's secure keychain and cleared when you turn the switch off.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = {
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#fff',
  },
};

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../api';
import { useAuth } from '../../App';
import { colors, shadow } from '../theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email, password, branch_code: branchCode || undefined } });
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
        <TextInput style={s.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
        <TextInput style={s.input} placeholder="Branch code (optional, e.g. RSG-CHN)" autoCapitalize="characters" value={branchCode} onChangeText={setBranchCode} />
        <TouchableOpacity style={{ backgroundColor: colors.brand, borderRadius: 10, padding: 14, marginTop: 6 }} onPress={submit} disabled={busy}>
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>{busy ? 'Signing in…' : 'Sign In'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = {
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#fff',
  },
};

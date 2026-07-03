import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useBranch } from '../App';
import { colors } from './theme';

export function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink2, marginBottom: 4 }}>{label}</Text>
      <TextInput
        style={{ backgroundColor: '#fff', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.line }}
        placeholderTextColor={colors.ink3}
        {...props}
      />
    </View>
  );
}

// Horizontal chip select. multi=true toggles values in an array.
export function Chips({ label, options, value, onChange, multi = false }) {
  const selected = v => (multi ? (value || []).includes(v) : value === v);
  const pick = v => {
    if (!multi) return onChange(v);
    const cur = value || [];
    onChange(selected(v) ? cur.filter(x => x !== v) : [...cur, v]);
  };
  return (
    <View style={{ marginBottom: 10 }}>
      {!!label && <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink2, marginBottom: 4 }}>{label}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map(o => (
          <TouchableOpacity key={String(o.value)} onPress={() => pick(o.value)}
            style={{
              paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16,
              backgroundColor: selected(o.value) ? colors.brand : colors.brandLight,
            }}>
            <Text style={{ color: selected(o.value) ? '#fff' : colors.brand, fontWeight: '700', fontSize: 12 }}>
              {o.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export function Btn({ title, onPress, color = colors.brand, disabled }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}
      style={{ backgroundColor: color, borderRadius: 10, padding: 13, opacity: disabled ? 0.5 : 1, marginBottom: 8 }}>
      <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800' }}>{title}</Text>
    </TouchableOpacity>
  );
}

// Branch selector strip — shown only when the user can switch branches
// (owner/auditor across all branches, or staff assigned to multiple branches).
export function BranchBar() {
  const { canSwitch, options, branchId, setBranchId, allBranchesOption } = useBranch();
  if (!canSwitch) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 40, marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {allBranchesOption && (
          <TouchableOpacity onPress={() => setBranchId('')}
            style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: !branchId ? colors.brand : '#fff', borderWidth: 1, borderColor: colors.line }}>
            <Text style={{ color: !branchId ? '#fff' : colors.ink2, fontWeight: '700', fontSize: 12 }}>All Branches</Text>
          </TouchableOpacity>
        )}
        {options.map(b => (
          <TouchableOpacity key={b.id} onPress={() => setBranchId(String(b.id))}
            style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: Number(branchId) === b.id ? colors.brand : '#fff', borderWidth: 1, borderColor: colors.line }}>
            <Text style={{ color: Number(branchId) === b.id ? '#fff' : colors.ink2, fontWeight: '700', fontSize: 12 }}>{b.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

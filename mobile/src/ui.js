import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { useBranch } from '../App';
import { colors, shadow } from './theme';

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

// Branch selector dropdown — shown only when the user can switch branches
// (owner/auditor across all branches, or staff assigned to multiple branches).
// requireBranch: screens that need ONE concrete branch (e.g. billing) drop the
// "All Branches" option and treat the first branch as selected by default.
export function BranchBar({ requireBranch = false }) {
  const { canSwitch, options, branchId, setBranchId, allBranchesOption } = useBranch();
  const [open, setOpen] = useState(false);
  if (!canSwitch) return null;
  const effective = Number(branchId) || (requireBranch ? options[0]?.id : null);
  const current = options.find(b => b.id === effective);
  const label = current ? current.name : 'All Branches';
  const choices = [
    ...(allBranchesOption && !requireBranch ? [{ id: '', name: 'All Branches' }] : []),
    ...options,
  ];
  return (
    <View style={{ marginBottom: 8 }}>
      <TouchableOpacity onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 10, paddingHorizontal: 12 }}>
        <Text style={{ fontSize: 12, color: colors.ink3, fontWeight: '700' }}>BRANCH  </Text>
        <Text style={{ flex: 1, fontWeight: '700', color: colors.brand }} numberOfLines={1}>🏬 {label}</Text>
        <Text style={{ color: colors.ink3 }}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'center', padding: 24 }}>
          <View style={[{ backgroundColor: '#fff', borderRadius: 14, paddingVertical: 6, maxHeight: '70%' }, shadow]}>
            <Text style={{ fontWeight: '800', fontSize: 15, padding: 12, color: colors.brandDark }}>Select branch</Text>
            <ScrollView>
              {choices.map(b => {
                const selected = b.id === '' ? (!effective && !requireBranch) : b.id === effective;
                return (
                  <TouchableOpacity key={String(b.id)}
                    onPress={() => { setBranchId(b.id === '' ? '' : String(b.id)); setOpen(false); }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, backgroundColor: selected ? colors.brandLight : '#fff', borderTopWidth: 1, borderColor: colors.line }}>
                    <Text style={{ flex: 1, fontWeight: selected ? '800' : '500', color: selected ? colors.brand : colors.ink }}>
                      {b.id === '' ? '🌐 All Branches' : `🏬 ${b.name}`}
                    </Text>
                    {selected && <Text style={{ color: colors.brand, fontWeight: '800' }}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

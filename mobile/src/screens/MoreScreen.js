import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useAuth, can } from '../../App';
import { colors, shadow } from '../theme';

export default function MoreScreen({ navigation }) {
  const { user, logout } = useAuth();
  const items = [
    can(user, 'inventory.view') && { t: '⏳ Expiry Check', nav: 'Expiry' },
    can(user, 'customers.view') && { t: '👥 Customer Search', nav: 'Customers' },
    can(user, 'delivery.view') && { t: '🛵 Deliveries', nav: 'Deliveries' },
    { t: '📋 My Tasks', nav: 'Tasks' },
    { t: '🕐 Attendance Check-in/out', nav: 'Attendance' },
    { t: '🔔 Notifications', nav: 'Notifications' },
  ].filter(Boolean);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 14 }}>
      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 }, shadow]}>
        <Text style={{ fontWeight: '800', fontSize: 16 }}>{user.name}</Text>
        <Text style={{ color: colors.ink3, marginTop: 2 }}>{user.email}</Text>
        <Text style={{ color: colors.brand, marginTop: 2, fontWeight: '600' }}>
          {user.role.replace(/_/g, ' ')} · {user.branch?.name || 'All branches'}
        </Text>
      </View>
      {items.map(x => (
        <TouchableOpacity key={x.t} onPress={() => navigation.navigate(x.nav)}
          style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10 }, shadow]}>
          <Text style={{ fontWeight: '700' }}>{x.t}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity onPress={logout}
        style={{ backgroundColor: colors.red, borderRadius: 12, padding: 16, marginTop: 8 }}>
        <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>Logout</Text>
      </TouchableOpacity>
      <Text style={{ textAlign: 'center', color: colors.ink3, fontSize: 11, marginTop: 16 }}>
        RS Group · Empowering Health, Enriching Education, Excelling in Sports
      </Text>
    </ScrollView>
  );
}

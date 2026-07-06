import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { useAuth, can } from '../../App';
import { BASE_URL, getAuthToken } from '../api';
import { colors, shadow } from '../theme';

export default function MoreScreen({ navigation }) {
  const { user, logout } = useAuth();
  const items = [
    can(user, 'billing.view', 'billing.create') && { t: '🧾 Sales & Bills', nav: 'Sales' },
    can(user, 'inventory.view') && { t: '⚠️ Stock Alerts', nav: 'Expiry' },
    can(user, 'inventory.view') && { t: '💊 Medicines', nav: 'Medicines' },
    can(user, 'inventory.transfer', 'inventory.view') && { t: '🔁 Stock Transfers', nav: 'Transfers' },
    can(user, 'discounts.manage') && { t: '🎁 Discounts & Offers', nav: 'Offers' },
    can(user, 'expenses.view', 'accounts.manage') && { t: '💵 Accounts & Expenses', nav: 'Accounts' },
    can(user, 'customers.view') && { t: '👥 Customers', nav: 'Customers' },
    can(user, 'reports.view') && { t: '📑 Reports', nav: 'Reports' },
    can(user, 'purchases.view') && { t: '📥 Purchases', nav: 'Purchases' },
    can(user, 'delivery.view') && { t: '🛵 Deliveries', nav: 'Deliveries' },
    can(user, 'staff.manage') && { t: '🧑‍⚕️ Users & Staff', nav: 'AdminUsers' },
    can(user, 'branches.manage') && { t: '🏬 Branches', nav: 'AdminBranches' },
    can(user, 'staff.manage') && { t: '📣 Announcements', nav: 'Announce' },
    user.role === 'super_admin' && { t: '💰 Usage & Cost', nav: 'Usage' },
    { t: '📋 My Tasks', nav: 'Tasks' },
    { t: '🕐 Attendance Check-in/out', nav: 'Attendance' },
    { t: '🔔 Notifications & Stock Updates', nav: 'Notifications' },
    { t: '⚙️ Settings', nav: 'Settings' },
    { t: '📖 User Manual (PDF)', open: `${BASE_URL}/api/manual?token=` },
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
        <TouchableOpacity key={x.t}
          onPress={() => x.open ? Linking.openURL(x.open + getAuthToken()) : navigation.navigate(x.nav)}
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

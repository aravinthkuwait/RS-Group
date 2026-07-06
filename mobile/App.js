import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View, Image, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, loadToken, setToken } from './src/api';
import { colors } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import BillingScreen from './src/screens/BillingScreen';
import StockScreen from './src/screens/StockScreen';
import MoreScreen from './src/screens/MoreScreen';
import ExpiryScreen from './src/screens/ExpiryScreen';
import CustomersScreen from './src/screens/CustomersScreen';
import DeliveriesScreen from './src/screens/DeliveriesScreen';
import TasksScreen from './src/screens/TasksScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import AdminUsersScreen from './src/screens/AdminUsersScreen';
import AdminBranchesScreen from './src/screens/AdminBranchesScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import PurchasesScreen from './src/screens/PurchasesScreen';
import PurchaseEntryScreen from './src/screens/PurchaseEntryScreen';
import UsageScreen from './src/screens/UsageScreen';
import SalesScreen from './src/screens/SalesScreen';
import TransfersScreen from './src/screens/TransfersScreen';
import OffersScreen from './src/screens/OffersScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import MedicinesScreen from './src/screens/MedicinesScreen';
import AnnounceScreen from './src/screens/AnnounceScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
export const can = (user, ...perms) =>
  user && (user.role === 'super_admin' || perms.some(p => (user.perms || []).includes(p)));

// Branch selection: owner/auditor can view any branch; staff assigned to
// multiple branches can switch between their assigned branches only.
const BranchCtx = createContext({ canSwitch: false, options: [], branchId: '' });
export const useBranch = () => useContext(BranchCtx);

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Company logo + page title shown in the header of every screen
function LogoTitle({ children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Image source={require('./assets/rs-group-logo.jpg')}
        style={{ width: 26, height: 26, borderRadius: 5, marginRight: 8, backgroundColor: '#fff' }} />
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17 }} numberOfLines={1}>{children}</Text>
    </View>
  );
}
const logoHeader = {
  headerStyle: { backgroundColor: colors.brand },
  headerTintColor: '#fff',
  headerTitle: props => <LogoTitle {...props} />,
};

function Tabs() {
  const { user } = useAuth();
  const icon = t => ({ Home: '📊', Billing: '🧾', Stock: '💊', More: '☰' }[t]);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...logoHeader,
        tabBarActiveTintColor: colors.brand,
        tabBarIcon: () => <Text style={{ fontSize: 18 }}>{icon(route.name)}</Text>,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'RS Group' }} />
      {can(user, 'billing.create') && <Tab.Screen name="Billing" component={BillingScreen} />}
      {can(user, 'inventory.view') && <Tab.Screen name="Stock" component={StockScreen} />}
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [branchId, setBranchId] = useState('');
  const [allBranches, setAllBranches] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        if (await loadToken()) {
          const d = await api('/auth/me');
          setUser(d.user);
        }
      } catch { await setToken(null); }
      setBooting(false);
    })();
  }, []);

  const isGlobal = user && ['super_admin', 'auditor'].includes(user.role);
  useEffect(() => {
    if (isGlobal) api('/admin/branches').then(d => setAllBranches(d.branches.filter(b => b.active))).catch(() => {});
  }, [isGlobal]);

  const branchCtx = useMemo(() => {
    const assigned = user?.branches || [];
    const multi = !isGlobal && assigned.length > 1;
    const options = isGlobal ? allBranches : assigned;
    const effective = isGlobal
      ? branchId
      : (multi && branchId && assigned.some(b => b.id === Number(branchId)) ? branchId : String(user?.branch_id || ''));
    return {
      options, branchId: effective, setBranchId,
      canSwitch: !!isGlobal || multi, allBranchesOption: !!isGlobal,
    };
  }, [user, isGlobal, allBranches, branchId]);

  const login = async d => { await setToken(d.token); setUser(d.user); };
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    await setToken(null); setUser(null); setBranchId('');
  };

  if (booting) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <AuthCtx.Provider value={{ user, login, logout }}>
      <BranchCtx.Provider value={branchCtx}>
        <StatusBar style="light" />
        <NavigationContainer>
          {!user ? <LoginScreen /> : (
            <Stack.Navigator screenOptions={logoHeader}>
              <Stack.Screen name="Main" component={Tabs} options={{ headerShown: false }} />
              <Stack.Screen name="Expiry" component={ExpiryScreen} options={{ title: 'Stock Alerts' }} />
              <Stack.Screen name="Sales" component={SalesScreen} options={{ title: 'Sales & Bills' }} />
              <Stack.Screen name="Transfers" component={TransfersScreen} options={{ title: 'Stock Transfers' }} />
              <Stack.Screen name="Offers" component={OffersScreen} options={{ title: 'Discounts & Offers' }} />
              <Stack.Screen name="Accounts" component={AccountsScreen} options={{ title: 'Accounts & Expenses' }} />
              <Stack.Screen name="Medicines" component={MedicinesScreen} options={{ title: 'Medicines' }} />
              <Stack.Screen name="Announce" component={AnnounceScreen} options={{ title: 'Announcements' }} />
              <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
              <Stack.Screen name="Customers" component={CustomersScreen} />
              <Stack.Screen name="Deliveries" component={DeliveriesScreen} />
              <Stack.Screen name="Tasks" component={TasksScreen} options={{ title: 'My Tasks' }} />
              <Stack.Screen name="Attendance" component={AttendanceScreen} />
              <Stack.Screen name="Notifications" component={NotificationsScreen} />
              <Stack.Screen name="Reports" component={ReportsScreen} />
              <Stack.Screen name="Purchases" component={PurchasesScreen} options={{ title: 'Purchases' }} />
              <Stack.Screen name="PurchaseEntry" component={PurchaseEntryScreen} options={{ title: 'New Purchase' }} />
              <Stack.Screen name="Usage" component={UsageScreen} options={{ title: 'Usage & Cost' }} />
              <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'Users & Staff' }} />
              <Stack.Screen name="AdminBranches" component={AdminBranchesScreen} options={{ title: 'Branches' }} />
            </Stack.Navigator>
          )}
        </NavigationContainer>
      </BranchCtx.Provider>
    </AuthCtx.Provider>
  );
}

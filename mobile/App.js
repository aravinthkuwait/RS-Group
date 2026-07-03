import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View, ActivityIndicator } from 'react-native';
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

function Tabs() {
  const { user } = useAuth();
  const icon = t => ({ Home: '📊', Billing: '🧾', Stock: '💊', More: '☰' }[t]);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.brand },
        headerTintColor: '#fff',
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
            <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.brand }, headerTintColor: '#fff' }}>
              <Stack.Screen name="Main" component={Tabs} options={{ headerShown: false }} />
              <Stack.Screen name="Expiry" component={ExpiryScreen} options={{ title: 'Expiry Check' }} />
              <Stack.Screen name="Customers" component={CustomersScreen} />
              <Stack.Screen name="Deliveries" component={DeliveriesScreen} />
              <Stack.Screen name="Tasks" component={TasksScreen} options={{ title: 'My Tasks' }} />
              <Stack.Screen name="Attendance" component={AttendanceScreen} />
              <Stack.Screen name="Notifications" component={NotificationsScreen} />
              <Stack.Screen name="Reports" component={ReportsScreen} />
              <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'Users & Staff' }} />
              <Stack.Screen name="AdminBranches" component={AdminBranchesScreen} options={{ title: 'Branches' }} />
            </Stack.Navigator>
          )}
        </NavigationContainer>
      </BranchCtx.Provider>
    </AuthCtx.Provider>
  );
}

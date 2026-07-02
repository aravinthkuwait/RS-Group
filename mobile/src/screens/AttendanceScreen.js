import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { colors, shadow } from '../theme';

export default function AttendanceScreen() {
  const [todayRec, setTodayRec] = useState(null);
  const [rows, setRows] = useState([]);

  const load = useCallback(() => {
    api('/staff/attendance/today').then(d => setTodayRec(d.attendance)).catch(() => {});
    api('/staff/attendance').then(d => setRows(d.attendance)).catch(() => {});
  }, []);
  useFocusEffect(load);

  const mark = async which => {
    try {
      await api(`/staff/attendance/${which}`, { method: 'POST', body: { method: 'mobile' } });
      load();
    } catch (e) { Alert.alert('Attendance', e.message); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 }, shadow]}>
        <Text style={{ fontWeight: '700', marginBottom: 10 }}>Today</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={() => mark('check-in')} disabled={!!todayRec?.check_in}
            style={{ flex: 1, backgroundColor: colors.green, opacity: todayRec?.check_in ? 0.5 : 1, borderRadius: 10, padding: 14 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800' }}>
              {todayRec?.check_in ? `In at ${todayRec.check_in}` : '✅ Check In'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => mark('check-out')} disabled={!todayRec?.check_in || !!todayRec?.check_out}
            style={{ flex: 1, backgroundColor: colors.orange, opacity: (!todayRec?.check_in || todayRec?.check_out) ? 0.5 : 1, borderRadius: 10, padding: 14 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800' }}>
              {todayRec?.check_out ? `Out at ${todayRec.check_out}` : '🕐 Check Out'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' }, shadow]}>
            <Text style={{ fontWeight: '600' }}>{item.date}</Text>
            <Text style={{ color: colors.ink2 }}>{item.check_in || '—'} → {item.check_out || 'on duty'}</Text>
          </View>
        )}
      />
    </View>
  );
}

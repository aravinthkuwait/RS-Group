import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { colors, shadow } from '../theme';

export default function TasksScreen() {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => {
    api('/staff/tasks').then(d => setRows(d.tasks)).catch(() => {});
  }, []);
  useFocusEffect(load);

  const setStatus = async (item, status) => {
    try {
      await api(`/staff/tasks/${item.id}`, { method: 'PUT', body: { status } });
      load();
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const statusColor = { pending: colors.orange, in_progress: colors.brand, done: colors.green, cancelled: colors.red };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No tasks assigned 🎉</Text>}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: statusColor[item.status] || colors.line }, shadow]}>
            <Text style={{ fontWeight: '700' }}>{item.title}</Text>
            {!!item.description && <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 2 }}>{item.description}</Text>}
            <Text style={{ color: colors.ink3, fontSize: 12, marginTop: 4 }}>
              {item.due_date ? `Due ${item.due_date} · ` : ''}{String(item.status).replace(/_/g, ' ')} · by {item.created_by_name}
            </Text>
            {item.status !== 'done' && item.status !== 'cancelled' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {item.status === 'pending' && (
                  <TouchableOpacity onPress={() => setStatus(item, 'in_progress')}
                    style={{ backgroundColor: colors.brand, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Start</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setStatus(item, 'done')}
                  style={{ backgroundColor: colors.green, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Mark done ✓</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

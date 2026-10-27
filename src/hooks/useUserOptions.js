import { useState, useEffect } from 'react';
import { backend } from '@/api/backendClient';

export function useUserOptions() {
  const [userOptions, setUserOptions] = useState([]);

  useEffect(() => {
    backend.functions.invoke('getUsers', {}).then(res => {
      const users = (res.data?.users || [])
        .filter(u => u.value != null && u.value !== '')
        .sort((a, b) => (a.label || a.value || '').localeCompare(b.label || b.value || ''));
      setUserOptions(users);
    }).catch(() => {});
  }, []);

  return userOptions;
}
import { useState, useEffect } from 'react';
import { backend } from '@/api/backendClient';

function displayName(profile) {
  return profile.display_name || profile.full_name || profile.email || '';
}

export function useUserOptions() {
  const [userOptions, setUserOptions] = useState([]);

  useEffect(() => {
    backend.users.list().then(profiles => {
      const users = (profiles || [])
        .map(p => ({ value: displayName(p), label: displayName(p), email: p.email }))
        .filter(u => u.value)
        .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      setUserOptions(users);
    }).catch(() => {});
  }, []);

  return userOptions;
}

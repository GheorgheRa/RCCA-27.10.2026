import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/api/backendClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setUser(null);
      setAuthError(null);
      setIsLoadingAuth(false);
      return;
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (error) {
      setAuthError({ type: 'profile_error', message: error.message });
      setIsLoadingAuth(false);
      return;
    }

    if (!profile) {
      setAuthError({
        type: 'profile_error',
        message: 'Your account profile has not been provisioned. Contact an administrator.',
      });
      setIsLoadingAuth(false);
      return;
    }

    setUser({
      ...profile,
      email: authUser.email,
      full_name: profile.full_name || profile.display_name || authUser.email,
    });
    setAuthError(null);
    setIsLoadingAuth(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthError({
        type: 'configuration_error',
        message: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.',
      });
      setIsLoadingAuth(false);
      return undefined;
    }

    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setAuthError({ type: 'auth_error', message: error.message });
        setIsLoadingAuth(false);
        return;
      }
      void loadProfile(data.session?.user || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (active) {
        setIsPasswordRecovery(event === 'PASSWORD_RECOVERY');
        void loadProfile(session?.user || null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const login = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const updatePassword = async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setIsPasswordRecovery(false);
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const navigateToLogin = () => { window.location.assign('/login'); };
  const checkUserAuth = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    await loadProfile(data.session?.user || null);
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: Boolean(user),
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authChecked: !isLoadingAuth,
      authError,
      isPasswordRecovery,
      logout,
      login,
      updatePassword,
      navigateToLogin,
      checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

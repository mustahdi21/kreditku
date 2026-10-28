/**
 * AuthProvider.tsx — Sumber tunggal informasi sesi, profil, organisasi aktif,
 * dan role pengguna.
 *
 * Alur:
 *   1. Ambil sesi Supabase (auto refresh, PKCE).
 *   2. Muat profil + daftar keanggotaan organisasi.
 *   3. Tentukan organisasi aktif dan role efektif.
 *   4. Ekspos `can(permission)` untuk kebutuhan tampilan.
 *
 * Bila pengguna terautentikasi tetapi belum menjadi anggota organisasi mana pun,
 * status `needsInvitation` diisi true dan aplikasi menampilkan halaman khusus
 * (bukan error mentah).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured, RPC, TABLES } from '@/lib/supabase';
import { toAppError, type AppError } from '@/lib/errors';
import type { MemberRole } from '@/core/types';
import { hasPermission, ROLE_PERMISSIONS, type Permission } from '@/auth/permissions';

export interface Profile {
  readonly id: string;
  readonly email: string;
  readonly full_name: string;
  readonly phone: string | null;
  readonly avatar_url: string | null;
  readonly is_active: boolean;
  readonly active_organization_id: string | null;
  readonly last_login_at: string | null;
}

export interface Membership {
  readonly id: string;
  readonly organization_id: string;
  readonly user_id: string;
  readonly role: MemberRole;
  readonly is_active: boolean;
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly code: string;
    readonly logo_url: string | null;
    readonly timezone: string;
    readonly currency: string;
    readonly locale: string;
  } | null;
}

export interface AuthState {
  readonly status: 'loading' | 'authenticated' | 'unauthenticated' | 'error' | 'unconfigured';
  readonly session: Session | null;
  readonly user: User | null;
  readonly profile: Profile | null;
  readonly memberships: readonly Membership[];
  readonly currentMembership: Membership | null;
  readonly organizationId: string | null;
  readonly role: MemberRole | null;
  readonly permissions: readonly Permission[];
  readonly needsInvitation: boolean;
  readonly error: AppError | null;
}

export interface AuthContextValue extends AuthState {
  readonly can: (permission: Permission) => boolean;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly requestPasswordReset: (email: string) => Promise<void>;
  readonly updatePassword: (password: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly updateProfile: (values: { fullName: string; phone: string | null }) => Promise<void>;
  readonly switchOrganization: (organizationId: string) => Promise<void>;
}

const initialState: AuthState = {
  status: 'loading',
  session: null,
  user: null,
  profile: null,
  memberships: [],
  currentMembership: null,
  organizationId: null,
  role: null,
  permissions: [],
  needsInvitation: false,
  error: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  is_active: boolean;
  organizations: {
    id: string;
    name: string;
    code: string;
    logo_url: string | null;
    timezone: string;
    currency: string;
    locale: string;
  } | null;
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>(
    isSupabaseConfigured() ? initialState : { ...initialState, status: 'unconfigured' },
  );
  const mounted = useRef(true);

  const loadProfile = useCallback(async (session: Session | null): Promise<void> => {
    if (!mounted.current) return;
    if (!session?.user) {
      setState({ ...initialState, status: 'unauthenticated' });
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const [profileResult, membershipResult] = await Promise.all([
        supabase.from(TABLES.profiles).select('*').eq('id', session.user.id).maybeSingle(),
        supabase
          .from(TABLES.members)
          .select(
            'id, organization_id, user_id, role, is_active, organizations (id, name, code, logo_url, timezone, currency, locale)',
          )
          .eq('user_id', session.user.id)
          .eq('is_active', true),
      ]);

      if (profileResult.error) throw profileResult.error;
      if (membershipResult.error) throw membershipResult.error;

      const profile = (profileResult.data as Profile | null) ?? null;
      const memberships: Membership[] = ((membershipResult.data ?? []) as unknown as MembershipRow[]).map((row) => ({
        id: row.id,
        organization_id: row.organization_id,
        user_id: row.user_id,
        role: row.role,
        is_active: row.is_active,
        organization: row.organizations,
      }));

      const preferred =
        memberships.find((membership) => membership.organization_id === profile?.active_organization_id) ??
        memberships[0] ??
        null;

      if (!mounted.current) return;

      setState({
        status: 'authenticated',
        session,
        user: session.user,
        profile,
        memberships,
        currentMembership: preferred,
        organizationId: preferred?.organization_id ?? null,
        role: preferred?.role ?? null,
        permissions: preferred ? ROLE_PERMISSIONS[preferred.role] : [],
        needsInvitation: memberships.length === 0,
        error: null,
      });

      // Mencatat waktu login terakhir (kegagalan tidak mengganggu aplikasi).
      void supabase.rpc(RPC.touchLogin).then(
        () => undefined,
        () => undefined,
      );
    } catch (error) {
      if (!mounted.current) return;
      setState((previous) => ({
        ...previous,
        status: 'error',
        session,
        user: session.user,
        error: toAppError(error),
      }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!isSupabaseConfigured()) return undefined;

    const supabase = getSupabaseClient();

    void (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setState({ ...initialState, status: 'error', error: toAppError(error) });
        return;
      }
      await loadProfile(data.session);
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setState({ ...initialState, status: 'unauthenticated' });
        return;
      }
      void loadProfile(session);
    });

    return () => {
      mounted.current = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw toAppError(error);
    await loadProfile(data.session);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    setState({ ...initialState, status: 'unauthenticated' });
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const supabase = getSupabaseClient();
    const redirectTo = `${window.location.origin}${window.location.pathname}#/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
    if (error) throw toAppError(error);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw toAppError(error);
  }, []);

  const refresh = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session);
  }, [loadProfile]);

  const updateProfile = useCallback(
    async (values: { fullName: string; phone: string | null }) => {
      const supabase = getSupabaseClient();
      if (!state.user) throw new Error('Sesi tidak ditemukan.');
      const { error } = await supabase
        .from(TABLES.profiles)
        .update({ full_name: values.fullName, phone: values.phone })
        .eq('id', state.user.id);
      if (error) throw toAppError(error);
      await refresh();
    },
    [refresh, state.user],
  );

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.rpc(RPC.switchOrganization, { p_organization_id: organizationId });
      if (error) throw toAppError(error);
      await refresh();
    },
    [refresh],
  );

  const can = useCallback(
    (permission: Permission) => hasPermission(state.role, permission),
    [state.role],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      can,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      refresh,
      updateProfile,
      switchOrganization,
    }),
    [state, can, signIn, signOut, requestPasswordReset, updatePassword, refresh, updateProfile, switchOrganization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Mengakses konteks autentikasi. Melempar error bila dipakai di luar provider. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth harus dipakai di dalam <AuthProvider>.');
  return context;
}

/** True bila pengguna memiliki izin tertentu (mempermudah kondisional di JSX). */
export function useCan(permission: Permission): boolean {
  return useAuth().can(permission);
}

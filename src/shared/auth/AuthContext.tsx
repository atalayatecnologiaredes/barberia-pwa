import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAuthStore } from "./AuthStore";
import type { AuthSession } from "./types";

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useAuthStore((state) => state.session);
  const isLoading = useAuthStore((state) => state.isLoading);
  const initialize = useAuthStore((state) => state.initialize);
  const login = useAuthStore((state) => state.login);
  const logout = useAuthStore((state) => state.logout);
  const requestPasswordReset = useAuthStore((state) => state.requestPasswordReset);
  const updatePassword = useAuthStore((state) => state.updatePassword);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <AuthContext.Provider value={{ session, isLoading, initialize, login, logout, requestPasswordReset, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return value;
}

"use client";

import { createContext, useContext } from "react";

export interface AppUser {
  id: string;
  name: string;
  role: string;
  organization?: { name: string; website?: string };
  customPermissions?: Record<string, string> | null;
  /** Fully-merged effective module permissions: role default (built-in or
   * custom org role) + any personal override. Computed server-side in
   * /api/auth/me so the client never has to re-derive custom-role state. */
  modulePermissions?: Record<string, string>;
}

export const UserContext = createContext<AppUser | null>(null);

export function useUser() {
  return useContext(UserContext);
}

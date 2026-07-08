"use client";

import { createContext, useContext } from "react";

export interface AppUser {
  id: string;
  name: string;
  role: string;
  organization?: { name: string; website?: string };
  customPermissions?: Record<string, string> | null;
}

export const UserContext = createContext<AppUser | null>(null);

export function useUser() {
  return useContext(UserContext);
}

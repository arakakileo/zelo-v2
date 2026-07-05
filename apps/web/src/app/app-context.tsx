'use client';

import { createContext, useContext } from 'react';
import type { UserProfile } from '@/lib/app';

export const AppContext = createContext<{ user: UserProfile | null }>({
  user: null,
});

export function useAppContext() {
  return useContext(AppContext);
}

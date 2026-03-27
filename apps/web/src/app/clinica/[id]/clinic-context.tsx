'use client';

import { createContext, useContext } from 'react';
import type { ClinicaDetalhe } from '@/lib/clinic';

export const ClinicContext = createContext<{ clinicaId: string; clinica: ClinicaDetalhe | null }>({
  clinicaId: '',
  clinica: null,
});

export function useClinicContext() {
  return useContext(ClinicContext);
}

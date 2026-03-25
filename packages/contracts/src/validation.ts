import { z } from 'zod';

/**
 * Valida formato de CPF (apenas dígitos, 11 caracteres).
 * Não valida dígitos verificadores — isso é responsabilidade do serviço.
 */
export const cpfSchema = z
  .string()
  .regex(/^\d{11}$/, 'CPF deve conter exatamente 11 dígitos');

/**
 * Valida formato de CNPJ (apenas dígitos, 14 caracteres).
 */
export const cnpjSchema = z
  .string()
  .regex(/^\d{14}$/, 'CNPJ deve conter exatamente 14 dígitos');

/**
 * Valida CPF ou CNPJ (11 ou 14 dígitos).
 */
export const cpfCnpjSchema = z
  .string()
  .regex(/^\d{11}$|^\d{14}$/, 'Deve ser CPF (11 dígitos) ou CNPJ (14 dígitos)');

/**
 * Valida formato de email.
 */
export const emailSchema = z.string().email('Email inválido');

/**
 * Valida telefone brasileiro (apenas dígitos, 10 ou 11 dígitos).
 */
export const phoneSchema = z
  .string()
  .regex(/^\d{10,11}$/, 'Telefone deve conter 10 ou 11 dígitos');

/**
 * Valida UUID v4.
 */
export const uuidSchema = z.string().uuid('UUID inválido');

/**
 * Valida senha (mínimo 8 caracteres, pelo menos uma letra e um número).
 */
export const passwordSchema = z
  .string()
  .min(8, 'Senha deve ter pelo menos 8 caracteres')
  .regex(/[a-zA-Z]/, 'Senha deve conter pelo menos uma letra')
  .regex(/\d/, 'Senha deve conter pelo menos um número');

/**
 * Normaliza CPF removendo caracteres não numéricos.
 */
export function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

/**
 * Normaliza CNPJ removendo caracteres não numéricos.
 */
export function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '');
}

/**
 * Normaliza email (lowercase + trim).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normaliza telefone removendo caracteres não numéricos.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

import { createHash } from 'node:crypto';

/**
 * Blind Index Service for encrypted field searching.
 *
 * Since PII fields (CPF, email, phone) are encrypted and cannot be queried
 * directly via SQL, we store a deterministic SHA-256 hash alongside the
 * ciphertext. This hash is computed from normalized input + a secret pepper.
 *
 * IMPORTANT: The pepper must be different from the encryption key, and must
 * never change once data is in production (changing it breaks all lookups).
 *
 * @example
 * const service = new BlindIndexService(process.env.BLIND_INDEX_PEPPER);
 * const hash = service.hashCpf('123.456.789-00');
 * // Use hash in DB query: prisma.paciente.findUnique({ where: { cpfHash: hash } })
 */
export class BlindIndexService {
  private readonly pepper: string;

  /**
   * @param pepper - Secret string appended before hashing (BLIND_INDEX_PEPPER env var)
   */
  constructor(pepper: string) {
    if (!pepper || pepper.length < 8) {
      throw new Error('BLIND_INDEX_PEPPER must be at least 8 characters long');
    }
    this.pepper = pepper;
  }

  /**
   * Computes a deterministic SHA-256 hash of a normalized value + pepper.
   * Output is a 64-character hex string.
   *
   * @param normalizedValue - Pre-normalized plaintext (digits only, lowercase, etc.)
   * @returns 64-char hex SHA-256 hash
   */
  hash(normalizedValue: string): string {
    return createHash('sha256').update(normalizedValue + this.pepper).digest('hex');
  }

  /**
   * Normalizes and hashes a CPF.
   * Normalization: digits only (strips dots and dashes).
   *
   * @param cpf - CPF in any format (e.g. "123.456.789-00" or "12345678900")
   * @returns 64-char hex hash
   */
  hashCpf(cpf: string): string {
    const normalized = cpf.replace(/\D/g, '');
    if (normalized.length !== 11) {
      throw new Error(`Invalid CPF length after normalization: ${normalized.length} digits`);
    }
    return this.hash(normalized);
  }

  /**
   * Normalizes and hashes an email address.
   * Normalization: trim whitespace + lowercase.
   *
   * @param email - Email address in any case
   * @returns 64-char hex hash
   */
  hashEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) {
      throw new Error('Invalid email format');
    }
    return this.hash(normalized);
  }

  /**
   * Normalizes and hashes a phone number.
   * Normalization: digits only.
   *
   * @param phone - Phone number in any format
   * @returns 64-char hex hash
   */
  hashPhone(phone: string): string {
    const normalized = phone.replace(/\D/g, '');
    if (normalized.length < 8) {
      throw new Error('Phone number too short after normalization');
    }
    return this.hash(normalized);
  }

  /**
   * Normalizes and hashes a CNPJ or CPF (clinic document).
   * Normalization: digits only.
   *
   * @param cnpjCpf - CNPJ (14 digits) or CPF (11 digits) in any format
   * @returns 64-char hex hash
   */
  hashCnpjCpf(cnpjCpf: string): string {
    const normalized = cnpjCpf.replace(/\D/g, '');
    if (normalized.length !== 11 && normalized.length !== 14) {
      throw new Error(`Invalid CNPJ/CPF length: ${normalized.length} digits (expected 11 or 14)`);
    }
    return this.hash(normalized);
  }
}

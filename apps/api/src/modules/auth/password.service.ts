import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * Password hashing service.
 *
 * New passwords are hashed with argon2id (OWASP recommended).
 * Legacy SHA-256+salt hashes (format "salt:hash") are detected by their
 * format and verified with the old algorithm. On successful legacy
 * verification, `needsRehash()` returns true so the caller can upgrade
 * the stored hash to argon2id on next login.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */
@Injectable()
export class PasswordService {
  // argon2id parameters — tuned for ~250ms on commodity hardware.
  private readonly argon2Options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3, // 3 iterations
    parallelism: 4,
  };

  /**
   * Hash a password with argon2id.
   * The encoded hash string contains the algorithm identifier, salt,
   * and parameters so it can be verified without storing them separately.
   */
  async hash(password: string): Promise<string> {
    return argon2.hash(password, this.argon2Options);
  }

  /**
   * Verify a password against a stored hash.
   * Supports both argon2id (current) and legacy SHA-256+salt.
   *
   * @returns true if the password matches.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    // argon2 hashes start with $argon2
    if (stored.startsWith('$argon2')) {
      try {
        return await argon2.verify(stored, password);
      } catch {
        return false;
      }
    }

    // Legacy SHA-256+salt format: "salt:hash" (both hex)
    return this.verifyLegacySha256(password, stored);
  }

  /**
   * Returns true if the stored hash uses the legacy algorithm
   * and should be re-hashed to argon2id.
   */
  needsRehash(stored: string): boolean {
    // argon2 hashes start with $argon2id (or $argon2i/$argon2d)
    if (stored.startsWith('$argon2id')) {
      // Could also check if parameters are below current thresholds,
      // but for now any argon2id hash is acceptable.
      return false;
    }
    return true; // legacy SHA-256 or unknown format
  }

  /**
   * Legacy SHA-256+salt verification for backward compatibility.
   * Format: "salt:hash" (both hex).
   * @internal
   */
  private verifyLegacySha256(password: string, stored: string): boolean {
    const sepIndex = stored.indexOf(':');
    if (sepIndex === -1) return false;

    const salt = stored.slice(0, sepIndex);
    const storedHash = stored.slice(sepIndex + 1);
    if (!salt || !storedHash) return false;

    const hash = createHash('sha256').update(salt + password).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch {
      return false;
    }
  }
}

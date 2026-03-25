import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Versioned encryption envelope stored as JSON.
 * v: version — used for future key rotation and algorithm migration.
 * iv: base64-encoded initialization vector (12 bytes for AES-256-GCM)
 * tag: base64-encoded authentication tag (16 bytes)
 * ct: base64-encoded ciphertext
 */
interface EncryptionEnvelope {
  v: number;
  iv: string;
  tag: string;
  ct: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const CURRENT_VERSION = 1;

/**
 * AES-256-GCM encryption service.
 *
 * All PII (names, CPF, emails, etc.) must be encrypted before persistence.
 * The envelope format supports future key rotation via the version field.
 *
 * @example
 * const service = new CryptoService(process.env.ENCRYPTION_KEY);
 * const encrypted = service.encrypt('João da Silva');
 * const decrypted = service.decrypt(encrypted); // 'João da Silva'
 */
export class CryptoService {
  private readonly key: Buffer;

  /**
   * @param encryptionKey - 32-byte base64-encoded key (ENCRYPTION_KEY env var)
   */
  constructor(encryptionKey: string) {
    const keyBuffer = Buffer.from(encryptionKey, 'base64');
    if (keyBuffer.length !== 32) {
      throw new Error(
        `Invalid ENCRYPTION_KEY: expected 32 bytes after base64 decode, got ${keyBuffer.length}`,
      );
    }
    this.key = keyBuffer;
  }

  /**
   * Encrypts a plaintext string using AES-256-GCM.
   * Returns a base64-encoded JSON envelope for safe DB storage.
   *
   * @param plaintext - The raw string to encrypt
   * @returns base64-encoded JSON envelope
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const plaintextBuffer = Buffer.from(plaintext, 'utf8');
    const ct = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    const envelope: EncryptionEnvelope = {
      v: CURRENT_VERSION,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ct.toString('base64'),
    };

    return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
  }

  /**
   * Decrypts an envelope previously produced by `encrypt`.
   * Validates the authentication tag (tamper detection).
   *
   * @param envelopeBase64 - base64-encoded JSON envelope
   * @returns The original plaintext string
   * @throws If the envelope is invalid, tampered, or uses an unknown version
   */
  decrypt(envelopeBase64: string): string {
    let envelope: EncryptionEnvelope;
    try {
      const json = Buffer.from(envelopeBase64, 'base64').toString('utf8');
      envelope = JSON.parse(json) as EncryptionEnvelope;
    } catch {
      throw new Error('Invalid encryption envelope: failed to parse JSON');
    }

    if (envelope.v !== CURRENT_VERSION) {
      throw new Error(`Unsupported envelope version: ${envelope.v}`);
    }

    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ct = Buffer.from(envelope.ct, 'base64');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plaintext.toString('utf8');
  }
}

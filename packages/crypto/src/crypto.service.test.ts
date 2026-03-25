import { CryptoService } from './crypto.service';
import { randomBytes } from 'node:crypto';

describe('CryptoService', () => {
  const validKey = randomBytes(32).toString('base64');
  let service: CryptoService;

  beforeEach(() => {
    service = new CryptoService(validKey);
  });

  describe('constructor', () => {
    it('accepts a valid 32-byte base64 key', () => {
      expect(() => new CryptoService(validKey)).not.toThrow();
    });

    it('rejects a key that decodes to fewer than 32 bytes', () => {
      const shortKey = Buffer.from('short').toString('base64');
      expect(() => new CryptoService(shortKey)).toThrow('Invalid ENCRYPTION_KEY');
    });

    it('rejects a key that decodes to more than 32 bytes', () => {
      const longKey = randomBytes(64).toString('base64');
      expect(() => new CryptoService(longKey)).toThrow('Invalid ENCRYPTION_KEY');
    });
  });

  describe('encrypt', () => {
    it('returns a base64 string', () => {
      const encrypted = service.encrypt('test data');
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    });

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const plaintext = 'same input';
      const enc1 = service.encrypt(plaintext);
      const enc2 = service.encrypt(plaintext);
      expect(enc1).not.toEqual(enc2);
    });

    it('produces valid JSON envelope after base64 decode', () => {
      const encrypted = service.encrypt('some value');
      const json = Buffer.from(encrypted, 'base64').toString('utf8');
      const envelope = JSON.parse(json);
      expect(envelope).toHaveProperty('v', 1);
      expect(envelope).toHaveProperty('iv');
      expect(envelope).toHaveProperty('tag');
      expect(envelope).toHaveProperty('ct');
    });
  });

  describe('decrypt', () => {
    it('round-trips a plaintext string', () => {
      const original = 'João da Silva - CPF 123.456.789-00';
      const encrypted = service.encrypt(original);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toEqual(original);
    });

    it('handles empty strings', () => {
      const encrypted = service.encrypt('');
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toEqual('');
    });

    it('handles unicode characters', () => {
      const original = '中文 العربية 🎉 ñoño café';
      const encrypted = service.encrypt(original);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toEqual(original);
    });

    it('throws on invalid base64', () => {
      expect(() => service.decrypt('not valid base64!!!')).toThrow();
    });

    it('throws on valid base64 but invalid JSON', () => {
      const invalid = Buffer.from('not json').toString('base64');
      expect(() => service.decrypt(invalid)).toThrow('Invalid encryption envelope');
    });

    it('throws on unknown envelope version', () => {
      const envelope = { v: 999, iv: 'a', tag: 'b', ct: 'c' };
      const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64');
      expect(() => service.decrypt(encoded)).toThrow('Unsupported envelope version');
    });

    it('throws if ciphertext is tampered (auth tag mismatch)', () => {
      const encrypted = service.encrypt('secret data');
      const json = Buffer.from(encrypted, 'base64').toString('utf8');
      const envelope = JSON.parse(json);
      envelope.ct = Buffer.from('tampered').toString('base64');
      const tampered = Buffer.from(JSON.stringify(envelope)).toString('base64');
      expect(() => service.decrypt(tampered)).toThrow();
    });
  });
});

import { BlindIndexService } from './blind-index.service';

describe('BlindIndexService', () => {
  const pepper = 'test-pepper-min-8-chars';
  let service: BlindIndexService;

  beforeEach(() => {
    service = new BlindIndexService(pepper);
  });

  describe('constructor', () => {
    it('accepts a pepper with at least 8 characters', () => {
      expect(() => new BlindIndexService('12345678')).not.toThrow();
    });

    it('rejects a pepper shorter than 8 characters', () => {
      expect(() => new BlindIndexService('short')).toThrow('at least 8 characters');
    });

    it('rejects an empty pepper', () => {
      expect(() => new BlindIndexService('')).toThrow('at least 8 characters');
    });
  });

  describe('hash', () => {
    it('returns a 64-character hex string', () => {
      const hash = service.hash('test value');
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });

    it('produces the same hash for the same input', () => {
      const input = '12345678900';
      expect(service.hash(input)).toEqual(service.hash(input));
    });

    it('produces different hashes for different inputs', () => {
      expect(service.hash('input1')).not.toEqual(service.hash('input2'));
    });

    it('produces different hashes with different peppers', () => {
      const service2 = new BlindIndexService('different-pepper');
      expect(service.hash('same input')).not.toEqual(service2.hash('same input'));
    });
  });

  describe('hashCpf', () => {
    it('normalizes CPF with dots and dash', () => {
      const formatted = '123.456.789-00';
      const digitsOnly = '12345678900';
      expect(service.hashCpf(formatted)).toEqual(service.hash(digitsOnly));
    });

    it('throws for CPF with wrong length', () => {
      expect(() => service.hashCpf('12345678')).toThrow('Invalid CPF length');
    });

    it('produces deterministic hash', () => {
      const cpf = '987.654.321-00';
      const hash1 = service.hashCpf(cpf);
      const hash2 = service.hashCpf(cpf);
      expect(hash1).toEqual(hash2);
    });
  });

  describe('hashEmail', () => {
    it('normalizes email to lowercase', () => {
      const upper = 'TEST@EXAMPLE.COM';
      const lower = 'test@example.com';
      expect(service.hashEmail(upper)).toEqual(service.hashEmail(lower));
    });

    it('trims whitespace', () => {
      const withSpaces = '  user@example.com  ';
      const trimmed = 'user@example.com';
      expect(service.hashEmail(withSpaces)).toEqual(service.hashEmail(trimmed));
    });

    it('throws for email without @', () => {
      expect(() => service.hashEmail('notanemail')).toThrow('Invalid email format');
    });
  });

  describe('hashPhone', () => {
    it('normalizes phone to digits only', () => {
      const formatted = '+55 (11) 99999-8888';
      const digitsOnly = '5511999998888';
      expect(service.hashPhone(formatted)).toEqual(service.hash(digitsOnly));
    });

    it('throws for phone too short', () => {
      expect(() => service.hashPhone('123')).toThrow('too short');
    });
  });

  describe('hashCnpjCpf', () => {
    it('accepts valid CPF (11 digits)', () => {
      const cpf = '123.456.789-00';
      expect(() => service.hashCnpjCpf(cpf)).not.toThrow();
    });

    it('accepts valid CNPJ (14 digits)', () => {
      const cnpj = '12.345.678/0001-90';
      expect(() => service.hashCnpjCpf(cnpj)).not.toThrow();
    });

    it('throws for invalid length', () => {
      expect(() => service.hashCnpjCpf('123456')).toThrow('Invalid CNPJ/CPF length');
    });
  });
});

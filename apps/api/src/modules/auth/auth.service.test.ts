import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  createMockPrismaService,
  createMockConfigService,
  createMockJwtService,
} from '../../test-utils';

describe('AuthService', () => {
  let service: AuthService;
  // PrismaMockService uses a Proxy; typed as any for ergonomic test access.
  let mockPrisma: any;
  let resetPrismaMock: () => void;
  let mockJwt: ReturnType<typeof createMockJwtService>;
  let mockConfig: ReturnType<typeof createMockConfigService>;
  let passwordService: PasswordService;

  beforeEach(async () => {
    const prismaMock = createMockPrismaService();
    mockPrisma = prismaMock.mockPrismaService;
    resetPrismaMock = prismaMock.resetPrismaMock;
    mockJwt = createMockJwtService();
    mockConfig = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(AuthService);
    passwordService = module.get(PasswordService);
    resetPrismaMock();
  });

  // ─── Registration ───

  describe('register', () => {
    const validDto = {
      email: 'newuser@zelo.dev',
      senha: 'Senha123',
      nomeCompleto: 'New User',
      cpf: '12345678900',
    };

    it('creates a user and returns a token pair', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null); // no existing email/CPF
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'newuser@zelo.dev',
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
      mockJwt.sign.mockReturnValue('jwt-token');

      const result = await service.register(validDto);

      expect(result.accessToken).toBe('jwt-token');
      expect(result.refreshToken).toBe('jwt-token');
      // Verify password was hashed (not stored plaintext)
      const createCall = mockPrisma.user.create.mock.calls[0]![0];
      expect(createCall.data.senhaHash).not.toBe('Senha123');
      expect(createCall.data.senhaHash.startsWith('$argon2')).toBe(true);
      // Verify CPF was encrypted (not stored plaintext)
      expect(createCall.data.cpfEncrypted).not.toBe('12345678900');
    });

    it('throws ConflictException on duplicate email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.register(validDto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on duplicate CPF', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce({ id: 'existing' }); // CPF check

      await expect(service.register(validDto)).rejects.toThrow(ConflictException);
    });

    it('normalizes email to lowercase', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'u1', email: 'test@zelo.dev' });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      await service.register({ ...validDto, email: 'Test@ZELO.DEV' });

      const findCall = mockPrisma.user.findUnique.mock.calls[0]![0];
      expect(findCall.where.email).toBe('test@zelo.dev');
    });
  });

  // ─── Login ───

  describe('login', () => {
    it('returns a token pair on valid credentials', async () => {
      const hash = await passwordService.hash('Senha123');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@zelo.dev',
        senhaHash: hash,
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
      mockJwt.sign.mockReturnValue('jwt-token');

      const result = await service.login({ email: 'test@zelo.dev', senha: 'Senha123' });

      expect(result.accessToken).toBe('jwt-token');
      expect(result.refreshToken).toBe('jwt-token');
    });

    it('throws UnauthorizedException on wrong password', async () => {
      const hash = await passwordService.hash('Senha123');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@zelo.dev',
        senhaHash: hash,
      });

      await expect(
        service.login({ email: 'test@zelo.dev', senha: 'WrongPassword1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@zelo.dev', senha: 'Senha123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('upgrades legacy SHA-256 hash to argon2 on successful login', async () => {
      // Create a legacy SHA-256 hash (salt:hash format)
      const legacyHash = createLegacySha256Hash('Senha123');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@zelo.dev',
        senhaHash: legacyHash,
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
      mockJwt.sign.mockReturnValue('jwt-token');

      await service.login({ email: 'test@zelo.dev', senha: 'Senha123' });

      // Verify hash was upgraded
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.user.update.mock.calls[0]![0];
      expect(updateCall.data.senhaHash.startsWith('$argon2')).toBe(true);
    });

    it('does not upgrade hash when already argon2', async () => {
      const hash = await passwordService.hash('Senha123');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@zelo.dev',
        senhaHash: hash,
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      await service.login({ email: 'test@zelo.dev', senha: 'Senha123' });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  // ─── Refresh Tokens ───

  describe('refreshTokens', () => {
    it('returns a new token pair on valid refresh token', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@zelo.dev',
        jti: 'jti-1',
        fid: 'family-1',
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: '', // will be set below
        revoked: false,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@zelo.dev',
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });
      mockJwt.sign.mockReturnValue('new-token');
      mockPrisma.refreshToken.update.mockResolvedValue({});

      // The stored tokenHash needs to match the hash of the refresh token.
      // Since mockJwt.sign returns 'new-token', the issueRefreshToken creates
      // a hash of 'new-token'. We need to set the stored hash to match the
      // hash of the raw token being passed in. The raw token is 'mock-refresh-token'.
      const rawToken = 'mock-refresh-token';
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        revoked: false,
      });

      const result = await service.refreshTokens(rawToken);

      expect(result.accessToken).toBe('new-token');
      // Old token should be revoked
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: expect.objectContaining({ revoked: true }),
        }),
      );
    });

    it('throws when refresh token JWT is invalid', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      await expect(service.refreshTokens('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when refresh token is not found in DB', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@zelo.dev',
        jti: 'unknown-jti',
        fid: 'family-1',
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('some-token')).rejects.toThrow(UnauthorizedException);
    });

    it('revokes entire family on reuse of a revoked token', async () => {
      const rawToken = 'mock-refresh-token';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@zelo.dev',
        jti: 'jti-1',
        fid: 'family-1',
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        revoked: true, // already revoked → reuse!
      });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.refreshTokens(rawToken)).rejects.toThrow(UnauthorizedException);

      // Verify the entire family was revoked
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { familyId: 'family-1', revoked: false },
          data: { revoked: true },
        }),
      );
    });
  });

  // ─── Logout ───

  describe('logout', () => {
    it('revokes the refresh token', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@zelo.dev',
        jti: 'jti-1',
        fid: 'family-1',
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        familyId: 'family-1',
        jti: 'jti-1',
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      const result = await service.logout('valid-refresh-token');

      expect(result.mensagem).toContain('Logout');
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: { revoked: true },
        }),
      );
    });

    it('returns success even with invalid token', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('expired');
      });

      const result = await service.logout('expired-token');

      expect(result.mensagem).toContain('Logout');
    });
  });

  // ─── Profile ───

  describe('getProfile', () => {
    it('returns user profile with memberships', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@zelo.dev',
        nomeCompleto: 'Test User',
        createdAt: new Date(),
        memberships: [
          {
            id: 'm1',
            clinicaId: 'c1',
            papel: 'ADMIN',
            clinica: { id: 'c1', razaoSocial: 'Clinica A', nomeFantasia: 'A' },
          },
        ],
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile('user-1');

      expect(result.id).toBe('user-1');
      expect(result.memberships).toHaveLength(1);
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── PasswordService unit tests ───

  describe('PasswordService', () => {
    it('hashes and verifies with argon2id', async () => {
      const hash = await passwordService.hash('mypassword');
      expect(hash.startsWith('$argon2id')).toBe(true);
      expect(await passwordService.verify('mypassword', hash)).toBe(true);
      expect(await passwordService.verify('wrong', hash)).toBe(false);
    });

    it('detects legacy hashes that need rehashing', () => {
      const argonHash = '$argon2id$v=19$m=65536,t=3,p=4$abc';
      const legacyHash = 'aabbccdd:eeff0011';

      expect(passwordService.needsRehash(argonHash)).toBe(false);
      expect(passwordService.needsRehash(legacyHash)).toBe(true);
    });

    it('verifies legacy SHA-256+salt hashes', async () => {
      const legacyHash = createLegacySha256Hash('OldPassword1');
      expect(await passwordService.verify('OldPassword1', legacyHash)).toBe(true);
      expect(await passwordService.verify('wrong', legacyHash)).toBe(false);
    });

    it('rejects malformed stored hashes', async () => {
      expect(await passwordService.verify('pw', '')).toBe(false);
      expect(await passwordService.verify('pw', 'no-colon-here')).toBe(false);
    });
  });
});

/**
 * Helper: create a legacy SHA-256+salt hash (old format).
 */
function createLegacySha256Hash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService, BlindIndexService } from '@zelo/crypto';
import { PasswordService } from './password.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/// Default refresh-token lifetime (used when JWT_REFRESH_EXPIRY env is absent).
const DEFAULT_REFRESH_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly crypto: CryptoService;
  private readonly blindIndex: BlindIndexService;
  private readonly refreshExpirySeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwordService: PasswordService,
  ) {
    this.crypto = new CryptoService(this.config.getOrThrow<string>('ENCRYPTION_KEY'));
    this.blindIndex = new BlindIndexService(this.config.getOrThrow<string>('BLIND_INDEX_PEPPER'));
    this.refreshExpirySeconds = this.parseExpirySeconds(
      this.config.get<string>('JWT_REFRESH_EXPIRY'),
      DEFAULT_REFRESH_EXPIRY_SECONDS,
    );
  }

  /**
   * Register a new user account.
   * - Hashes password with argon2id
   * - Encrypts CPF with AES-256-GCM
   * - Stores blind index hash for CPF lookup
   * - Issues a new refresh-token family
   */
  async register(dto: RegisterDto): Promise<TokenPair> {
    const emailLower = dto.email.trim().toLowerCase();

    // Check if email already exists
    const existing = await this.prisma.user.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email já cadastrado');
    }

    // Check if CPF already exists
    const cpfDigits = dto.cpf.replace(/\D/g, '');
    const cpfHash = this.blindIndex.hashCpf(cpfDigits);
    const existingCpf = await this.prisma.user.findUnique({
      where: { cpfHash },
      select: { id: true },
    });
    if (existingCpf) {
      throw new ConflictException('CPF já cadastrado');
    }

    const senhaHash = await this.passwordService.hash(dto.senha);
    const cpfEncrypted = this.crypto.encrypt(cpfDigits);

    const user = await this.prisma.user.create({
      data: {
        email: emailLower,
        senhaHash,
        nomeCompleto: dto.nomeCompleto,
        cpfEncrypted,
        cpfHash,
      },
    });

    this.logger.log(`User registered: ${user.id}`);
    return this.issueTokenPair(user.id, user.email);
  }

  /**
   * Authenticate user by email + password.
   * Transparently upgrades legacy SHA-256 hashes to argon2id on successful login.
   */
  async login(dto: LoginDto): Promise<TokenPair> {
    const emailLower = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: emailLower, deletedAt: null },
      select: { id: true, email: true, senhaHash: true },
    });

    if (!user || !(await this.passwordService.verify(dto.senha, user.senhaHash))) {
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    // Upgrade legacy hash to argon2id
    if (this.passwordService.needsRehash(user.senhaHash)) {
      const newHash = await this.passwordService.hash(dto.senha);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { senhaHash: newHash },
      });
      this.logger.debug(`Password hash upgraded for user ${user.id}`);
    }

    this.logger.log(`User logged in: ${user.id}`);
    return this.issueTokenPair(user.id, user.email);
  }

  /**
   * Generate a new token pair from a valid refresh token.
   * Implements rotation: the old refresh token is revoked and replaced by a new one
   * in the same family. If a revoked token is reused, the entire family is revoked
   * (token theft detection).
   *
   * @param rawRefreshToken - the raw refresh JWT from the Authorization header
   */
  async refreshTokens(rawRefreshToken: string): Promise<TokenPair> {
    // Verify the JWT signature + expiry first
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    let payload: { sub: string; email: string; jti: string; fid: string };
    try {
      payload = this.jwt.verify(rawRefreshToken, { secret: refreshSecret });
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    // Look up the stored token by jti
    const stored = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });

    if (!stored) {
      throw new UnauthorizedException('Refresh token não reconhecido');
    }

    // Reuse detection: a revoked token being presented again → revoke entire family
    if (stored.revoked) {
      this.logger.warn(`Refresh token reuse detected for user ${stored.userId}, family ${stored.familyId} — revoking family`);
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revoked: false },
        data: { revoked: true },
      });
      throw new UnauthorizedException('Refresh token revogado');
    }

    // Verify the token hasn't been substituted (tokenHash must match)
    const expectedHash = this.hashToken(rawRefreshToken);
    if (stored.tokenHash !== expectedHash) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    // Verify the user still exists and is active
    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    // Rotation: revoke old token, issue new token in same family
    const newPair = await this.issueRefreshToken(user.id, user.email, stored.familyId);

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true, replacedById: newPair.refreshTokenDbId },
    });

    return { accessToken: newPair.accessToken, refreshToken: newPair.refreshToken };
  }

  /**
   * Logout: revoke the refresh token (and optionally its family).
   * Access tokens are short-lived (30m) and stateless, so they expire naturally.
   *
   * @param rawRefreshToken - the raw refresh JWT from the Authorization header
   * @param revokeFamily - if true, revokes all tokens in the family (full logout)
   */
  async logout(rawRefreshToken: string, revokeFamily = false): Promise<{ mensagem: string }> {
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    let payload: { jti: string; fid: string };

    try {
      payload = this.jwt.verify(rawRefreshToken, { secret: refreshSecret });
    } catch {
      // Token is already invalid/expired — consider logout successful
      return { mensagem: 'Logout realizado com sucesso' };
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });

    if (stored) {
      if (revokeFamily) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId, revoked: false },
          data: { revoked: true },
        });
      } else {
        await this.prisma.refreshToken.update({
          where: { id: stored.id },
          data: { revoked: true },
        });
      }
      this.logger.log(`Logout: token ${stored.jti} revoked${revokeFamily ? ' (family)' : ''}`);
    }

    return { mensagem: 'Logout realizado com sucesso' };
  }

  /**
   * Get user profile by ID.
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        nomeCompleto: true,
        createdAt: true,
        memberships: {
          where: { estaAtivo: true, deletedAt: null },
          select: {
            id: true,
            clinicaId: true,
            papel: true,
            clinica: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return user;
  }

  // ─── Private Helpers ───

  /**
   * Issue a full token pair: access JWT + refresh JWT with a new family.
   * Used on register and login.
   */
  private async issueTokenPair(userId: string, email: string): Promise<TokenPair> {
    const familyId = randomBytes(32).toString('hex');
    const result = await this.issueRefreshToken(userId, email, familyId);
    return { accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  /**
   * Issue an access token + a new refresh token within the given family,
   * persisting the refresh token for rotation/reuse detection.
   */
  private async issueRefreshToken(
    userId: string,
    email: string,
    familyId: string,
  ): Promise<{ accessToken: string; refreshToken: string; refreshTokenDbId: string }> {
    const accessToken = this.jwt.sign({ sub: userId, email });

    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    const jti = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshExpirySeconds * 1000);

    const refreshToken = this.jwt.sign(
      { sub: userId, email, jti, fid: familyId },
      {
        secret: refreshSecret,
        expiresIn: this.refreshExpirySeconds,
      },
    );

    const dbToken = await this.prisma.refreshToken.create({
      data: {
        userId,
        jti,
        familyId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, refreshTokenDbId: dbToken.id };
  }

  /**
   * Hash a raw refresh token for safe DB storage.
   * We never store raw tokens — only their SHA-256 hash.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Parse an expiry string like "7d", "30m", "3600s" into seconds.
   * Falls back to `defaultSeconds` if the string is missing or unparseable.
   */
  private parseExpirySeconds(value: string | undefined, defaultSeconds: number): number {
    if (!value) return defaultSeconds;
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) return defaultSeconds;
    const num = parseInt(match[1]!, 10);
    const unit = match[2];
    switch (unit) {
      case 's': return num;
      case 'm': return num * 60;
      case 'h': return num * 3600;
      case 'd': return num * 86400;
      default: return defaultSeconds;
    }
  }
}

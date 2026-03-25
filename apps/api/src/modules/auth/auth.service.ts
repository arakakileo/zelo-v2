import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService, BlindIndexService } from '@zelo/crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

interface TokenPayload {
  sub: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly crypto: CryptoService;
  private readonly blindIndex: BlindIndexService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.crypto = new CryptoService(this.config.getOrThrow<string>('ENCRYPTION_KEY'));
    this.blindIndex = new BlindIndexService(this.config.getOrThrow<string>('BLIND_INDEX_PEPPER'));
  }

  /**
   * Register a new user account.
   * - Hashes password with SHA-256 + salt (production should use bcrypt/argon2)
   * - Encrypts CPF with AES-256-GCM
   * - Stores blind index hash for CPF lookup
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

    const senhaHash = this.hashPassword(dto.senha);
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
    return this.generateTokenPair({ sub: user.id, email: user.email });
  }

  /**
   * Authenticate user by email + password.
   */
  async login(dto: LoginDto): Promise<TokenPair> {
    const emailLower = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: emailLower, deletedAt: null },
      select: { id: true, email: true, senhaHash: true },
    });

    if (!user || !this.verifyPassword(dto.senha, user.senhaHash)) {
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    this.logger.log(`User logged in: ${user.id}`);
    return this.generateTokenPair({ sub: user.id, email: user.email });
  }

  /**
   * Generate a new access token from a valid refresh token.
   */
  async refreshTokens(userId: string, email: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return this.generateTokenPair({ sub: user.id, email: user.email });
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

  private generateTokenPair(payload: TokenPayload): TokenPair {
    const accessToken = this.jwt.sign(payload);

    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    const refreshToken = this.jwt.sign(payload, {
      secret: refreshSecret,
      expiresIn: '7d' as const,
    });

    return { accessToken, refreshToken };
  }

  /**
   * Hash password with SHA-256 + random salt.
   * Format: salt:hash (both hex)
   *
   * NOTE: For production, replace with bcrypt or argon2.
   */
  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = createHash('sha256').update(salt + password).digest('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verify password against stored salt:hash.
   */
  private verifyPassword(password: string, stored: string): boolean {
    const [salt, storedHash] = stored.split(':');
    if (!salt || !storedHash) return false;
    const hash = createHash('sha256').update(salt + password).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch {
      return false;
    }
  }
}

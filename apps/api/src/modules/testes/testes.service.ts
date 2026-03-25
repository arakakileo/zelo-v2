import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TestesService {
  private readonly logger = new Logger(TestesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Catálogo global de testes (apenas leitura).
   * Gerenciado apenas por superadmins direto no banco/painel interno.
   */
  async listarTestes() {
    return this.prisma.teste.findMany({
      select: {
        id: true,
        nome: true,
        sigla: true,
        precoCreditos: true,
      },
      orderBy: { nome: 'asc' },
    });
  }
}

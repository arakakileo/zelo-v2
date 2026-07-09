import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ClinicalTestDefinitionService,
  type CatalogEntry,
  type ProtocolCatalogEntry,
} from './clinical-test-definitions';

@Injectable()
export class TestesService {
  private readonly logger = new Logger(TestesService.name);
  private readonly clinicalDefinitions = new ClinicalTestDefinitionService();

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
        slug: true,
        manualRequired: true,
        structuredModel: true,
      },
      orderBy: { nome: 'asc' },
    });
  }

  /**
   * Catálogo estruturado de testes clínicos (portado do Project Gaia).
   * Retorna definições in-memory com campos, ações guiadas e saídas esperadas.
   */
  getCatalogoEstruturado(): {
    tests: CatalogEntry[];
    protocols: ProtocolCatalogEntry[];
  } {
    return {
      tests: this.clinicalDefinitions.getCatalog(),
      protocols: this.clinicalDefinitions.getProtocolCatalog(),
    };
  }

  /**
   * Definição de aplicação guiada para uma ação de teste.
   */
  getAplicacaoDefinicao(testeId: string, actionKey: string): {
    testName: string;
    testSlug: string;
    actionKey: string;
    actionLabel: string;
    configured: boolean;
    applicationType: string;
    message: string;
  } {
    // Tenta encontrar a definição pelo slug do teste no banco
    // Como as definições são in-memory, usamos o slug para matching
    const definition = this.clinicalDefinitions.getDefinitionBySlug(testeId)
      ?? this.clinicalDefinitions.getDefinition(testeId);

    if (!definition) {
      throw new NotFoundException(`Teste estruturado não encontrado: ${testeId}`);
    }

    const app = this.clinicalDefinitions.getApplicationDefinition(
      definition.name,
      actionKey,
    );

    if (!app) {
      throw new NotFoundException(
        `Ação de aplicação não encontrada: ${actionKey} para teste ${definition.name}`,
      );
    }

    return app;
  }
}

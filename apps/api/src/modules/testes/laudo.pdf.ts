/**
 * laudo.pdf — renderiza um DocumentoLaudo como PDF real via pdfkit.
 *
 * O conteúdo é EXATAMENTE o mesmo view model do `modeloLaudo` textual.
 * Não duplica regras — consome o DocumentoLaudo construído por LaudoBuilder.
 *
 * Retorna um Buffer de bytes PDF válidos (começa com `%PDF`).
 *
 * pdfkit é stream-based: os bytes só ficam disponíveis após o evento 'end'.
 * Por isso a função é async e resolve no fim do stream.
 */

import PDFDocument from 'pdfkit';
import type { DocumentoLaudo } from './laudo.types';

const MARGIN = 50;
const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_ITALIC = 'Helvetica-Oblique';

function separatorLine(pdf: PDFKit.PDFDocument): void {
  const y = pdf.y;
  pdf
    .moveTo(MARGIN, y)
    .lineTo(pdf.page.width - MARGIN, y)
    .strokeColor('#cccccc')
    .lineWidth(0.5)
    .stroke();
}

/**
 * Renderiza o DocumentoLaudo como PDF.
 * Retorna Promise<Buffer> — os bytes só ficam disponíveis após o stream
 * do pdfkit terminar (evento 'end').
 */
export function renderizarLaudoPdf(doc: DocumentoLaudo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', (err: Error) => reject(err));

    writeLaudoContent(pdf, doc);

    pdf.end();
  });
}

/**
 * Escreve o conteúdo do DocumentoLaudo no PDFDocument.
 * Separado para clareza — toda a lógica de layout vive aqui.
 */
function writeLaudoContent(pdf: PDFKit.PDFDocument, doc: DocumentoLaudo): void {
  // ─── Cabeçalho ──────────────────────────────────────────────────────────
  pdf
    .font(FONT_BOLD)
    .fontSize(16)
    .text(`Laudo Psicológico — ${doc.cabecalho.testeSigla}`, { align: 'center' });

  pdf.moveDown(0.3);
  pdf
    .font(FONT_REGULAR)
    .fontSize(10)
    .fillColor('#666666')
    .text(doc.cabecalho.testeNome, { align: 'center' });

  pdf.moveDown(0.8);

  // ─── Identificação ──────────────────────────────────────────────────────
  pdf.fillColor('#000000');
  pdf.font(FONT_BOLD).fontSize(11).text('Identificação');
  pdf.moveDown(0.2);
  separatorLine(pdf);
  pdf.moveDown(0.3);

  const idLines: Array<[string, string]> = [
    ['Paciente:', doc.cabecalho.pacienteNome],
    ['Profissional:', doc.cabecalho.profissionalNome],
    ['Registro:', doc.cabecalho.profissionalRegistro],
    ['Data da aplicação:', doc.cabecalho.dataAplicacao ?? 'Não registrada'],
    ['Instrumento:', `${doc.cabecalho.testeSigla} — ${doc.cabecalho.testeNome}`],
  ];

  for (const [label, value] of idLines) {
    pdf
      .font(FONT_BOLD)
      .fontSize(10)
      .text(label, { continued: true })
      .font(FONT_REGULAR)
      .text(` ${value}`);
  }

  pdf.moveDown(0.6);

  // ─── Respostas/Resultados ───────────────────────────────────────────────
  pdf.font(FONT_BOLD).fontSize(11).text('Respostas e resultados disponíveis');
  pdf.moveDown(0.2);
  separatorLine(pdf);
  pdf.moveDown(0.3);

  pdf.font(FONT_REGULAR).fontSize(10).text(doc.respostasResumo);

  pdf.moveDown(0.6);

  // ─── Resultado clínico (APENAS quando motor OK) ─────────────────────────
  if (doc.resultadoClinico) {
    pdf.font(FONT_BOLD).fontSize(11).text('Resultado clínico');
    pdf.moveDown(0.2);
    separatorLine(pdf);
    pdf.moveDown(0.3);

    const rc = doc.resultadoClinico;
    const rcLines: Array<[string, string]> = [
      ['Escore:', String(rc.score)],
      ['Classificação:', rc.banda],
      ['Versão do motor:', rc.versaoMotor],
      ['Versão da regra:', rc.versaoRegra ?? '—'],
    ];

    for (const [label, value] of rcLines) {
      pdf
        .font(FONT_BOLD)
        .fontSize(10)
        .text(label, { continued: true })
        .font(FONT_REGULAR)
        .text(` ${value}`);
    }
    pdf.moveDown(0.2);
    pdf.font(FONT_ITALIC).fontSize(9).fillColor('#444444').text(rc.observacao);
    pdf.fillColor('#000000');
    pdf.moveDown(0.6);
  }

  // ─── Aviso de manual (quando aplicável) ─────────────────────────────────
  if (doc.avisoManual) {
    pdf.font(FONT_BOLD).fontSize(11).fillColor('#8B4513').text('Aviso de dependência de manual');
    pdf.moveDown(0.2);
    separatorLine(pdf);
    pdf.moveDown(0.3);
    pdf.font(FONT_ITALIC).fontSize(9).fillColor('#8B4513').text(doc.avisoManual);
    pdf.fillColor('#000000');
    pdf.moveDown(0.6);
  }

  // ─── Conclusão do psicólogo ─────────────────────────────────────────────
  if (doc.conclusao) {
    pdf.font(FONT_BOLD).fontSize(11).text('Conclusão');
    pdf.moveDown(0.2);
    separatorLine(pdf);
    pdf.moveDown(0.3);
    pdf.font(FONT_REGULAR).fontSize(10).text(doc.conclusao);
    pdf.moveDown(0.6);
  }

  // ─── Observações e limitações ───────────────────────────────────────────
  if (doc.observacoes) {
    pdf.font(FONT_BOLD).fontSize(11).text('Observações e limitações');
    pdf.moveDown(0.2);
    separatorLine(pdf);
    pdf.moveDown(0.3);
    pdf.font(FONT_REGULAR).fontSize(9).fillColor('#555555').text(doc.observacoes);
    pdf.fillColor('#000000');
    pdf.moveDown(0.6);
  }

  // ─── Rodapé ─────────────────────────────────────────────────────────────
  pdf.moveDown(1);
  pdf
    .font(FONT_ITALIC)
    .fontSize(8)
    .fillColor('#999999')
    .text(
      'Documento gerado pelo sistema Zelo. Este modelo é editável e deve ser revisado e complementado pelo profissional responsável.',
      { align: 'center' },
    );
}

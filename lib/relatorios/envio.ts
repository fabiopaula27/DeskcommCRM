/**
 * O envio do relatório agendado: gera o PDF UMA vez e o entrega a cada destino.
 * Um destino que falha não impede os outros; as falhas voltam em texto para a
 * tela de Envio agendado mostrar. As dependências entram por parâmetro (o cron
 * monta as reais; o teste, falsas).
 */
import type { PeriodoDoEnvio } from "./agendamento";

export type DepsDoEnvio = {
  gerarPdf: (periodo: PeriodoDoEnvio) => Promise<Buffer>;
  enviarEmail: (e: {
    to: string[];
    subject: string;
    html: string;
    attachments: { filename: string; content: Buffer; contentType: string }[];
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Sobe o PDF e devolve um link assinado de curta duração (o canal baixa por ele). */
  publicarPdf: (pdf: Buffer, nomeDoArquivo: string) => Promise<string>;
  enviarWhatsapp: (telefone: string, url: string, nomeDoArquivo: string, legenda: string) => Promise<void>;
};

function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "empresa"
  );
}

const dataBr = (ymd: string) => ymd.split("-").reverse().join("/");

export async function enviarRelatorio(
  deps: DepsDoEnvio,
  args: { emails: string[]; telefones: string[]; periodo: PeriodoDoEnvio; empresa: string },
): Promise<{ enviado: boolean; falhas: string[] }> {
  const { emails, telefones, periodo, empresa } = args;
  if (emails.length === 0 && telefones.length === 0) {
    return { enviado: false, falhas: ["Nenhum e-mail ou telefone cadastrado."] };
  }

  const pdf = await deps.gerarPdf(periodo);
  const arquivo = `relatorio-${slug(empresa)}-${periodo.de === periodo.ate ? periodo.de : `${periodo.de}_a_${periodo.ate}`}.pdf`;
  const quando = periodo.de === periodo.ate ? dataBr(periodo.de) : `${dataBr(periodo.de)} a ${dataBr(periodo.ate)}`;
  const legenda = `Relatório de ${empresa} · ${quando}`;

  const falhas: string[] = [];
  let algumOk = false;

  if (emails.length > 0) {
    try {
      const r = await deps.enviarEmail({
        to: emails,
        subject: legenda,
        html: `<p>Olá,</p><p>Segue em anexo o relatório de <strong>${empresa.replace(/[<>&]/g, "")}</strong> do período ${quando}.</p>`,
        attachments: [{ filename: arquivo, content: pdf, contentType: "application/pdf" }],
      });
      if (r.ok) algumOk = true;
      else falhas.push(`E-mail: ${r.error ?? "falhou"}`);
    } catch (e) {
      falhas.push(`E-mail: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (telefones.length > 0) {
    let url: string | null = null;
    try {
      url = await deps.publicarPdf(pdf, arquivo);
    } catch (e) {
      falhas.push(`WhatsApp: não consegui preparar o arquivo (${e instanceof Error ? e.message : String(e)})`);
    }
    if (url) {
      for (const tel of telefones) {
        try {
          await deps.enviarWhatsapp(tel, url, arquivo, legenda);
          algumOk = true;
        } catch (e) {
          falhas.push(`WhatsApp ${tel}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  return { enviado: algumOk, falhas };
}

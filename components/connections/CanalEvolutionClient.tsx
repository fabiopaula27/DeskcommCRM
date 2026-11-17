"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { channelLabel, type ChannelSession } from "@/hooks/channels/useChannelSessions";
import { apiClient } from "@/lib/api/client";
import { ehProviderEvolution } from "@/lib/channels/capabilities";
import { randomId } from "@/lib/random-id";
import { ArrowsClockwise, CheckCircle, CircleNotch, Trash } from "@/lib/ui/icons";

import { ChannelAiAccess } from "./ChannelAiAccess";

/**
 * Conectar um número por QR pelo servidor Evolution da instalação.
 *
 * A chave do servidor nunca chega aqui: o browser só fala com as rotas do CRM
 * e recebe a imagem do QR. `isConfigured` vem do servidor (a página lê as
 * variáveis de ambiente); sem ele o cartão nem aparece, em vez de oferecer um
 * botão que só responde 503.
 *
 * O QR do WhatsApp expira em ~1 min e a Evolution o renova sozinha, por isso a
 * tela consulta a cada 5 s até o canal virar WORKING — e para ao desmontar.
 */

const INTERVALO_MS = 5_000;
const MOTIVO_NUMERO_EM_USO = "numero_em_uso";

function comoImagem(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
}

function rotuloDoStatus(status: string, t: (s: string) => string): string {
  if (status === "WORKING") return t("Conectado");
  if (status === "SCAN_QR_CODE") return t("Aguardando leitura do QR");
  if (status === "STARTING") return t("Iniciando");
  if (status === "FAILED") return t("Falhou");
  if (status === "STOPPED") return t("Desconectado");
  return status;
}

export function CanalEvolutionClient({ isConfigured }: { isConfigured: boolean }) {
  const t = useT();
  const [sessoes, setSessoes] = useState<ChannelSession[]>([]);
  const [conectando, setConectando] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [conectou, setConectou] = useState(false);
  const chave = useRef<string | null>(null);
  // Logo após conectar/reconectar o banco ainda pode mostrar o STOPPED antigo.
  const toleraParadoAte = useRef(0);

  const meus = sessoes.filter((s) => ehProviderEvolution(s.provider));

  const carregar = useCallback(async (): Promise<ChannelSession[]> => {
    const r = await apiClient.get<{ data: ChannelSession[] }>("/api/v1/channel-sessions");
    setSessoes(r.data);
    return r.data.filter((s) => ehProviderEvolution(s.provider));
  }, []);

  // Carga inicial: uma conexão que ficou no meio do caminho retoma o QR.
  useEffect(() => {
    if (!isConfigured) return;
    let vivo = true;
    carregar()
      .then((lista) => {
        if (!vivo) return;
        const pendente = lista.find((s) => s.status === "SCAN_QR_CODE" || s.status === "STARTING");
        if (pendente) setConectando(pendente.id);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [isConfigured, carregar]);

  // Polling a cada 5 s enquanto houver conexão em andamento; limpo ao desmontar.
  useEffect(() => {
    if (!conectando) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ciclo = async () => {
      try {
        const lista = await carregar();
        if (!vivo) return;
        const atual = lista.find((s) => s.id === conectando);
        const paradoSemTolerancia = atual?.status === "STOPPED" && Date.now() >= toleraParadoAte.current;
        if (!atual || atual.status === "WORKING" || atual.status === "FAILED" || paradoSemTolerancia) {
          setConectando(null);
          if (atual?.status === "WORKING") setConectou(true);
          return;
        }
        const r = await apiClient.get<{ data: { qr_base64: string | null } }>(
          `/api/v1/channels/evolution/${conectando}/qr`,
        );
        if (!vivo) return;
        if (r.data.qr_base64) setQr(r.data.qr_base64);
      } catch {
        // Falha pontual de rede: a próxima volta tenta de novo.
      }
      if (vivo) timer = setTimeout(() => void ciclo(), INTERVALO_MS);
    };
    timer = setTimeout(() => void ciclo(), INTERVALO_MS);
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
  }, [conectando, carregar]);

  const comecar = async (id: string, qrInicial: string | null) => {
    setQr(qrInicial);
    setConectou(false);
    toleraParadoAte.current = Date.now() + 30_000;
    setConectando(id);
    if (qrInicial) return;
    // Resposta idempotente sem QR: busca na rota própria.
    try {
      const r = await apiClient.get<{ data: { qr_base64: string | null } }>(
        `/api/v1/channels/evolution/${id}/qr`,
      );
      if (r.data.qr_base64) setQr(r.data.qr_base64);
    } catch {
      // O polling tenta de novo em 5 s.
    }
  };

  const conectar = async () => {
    setCriando(true);
    try {
      chave.current ??= randomId();
      const r = await apiClient.post<{ data: { channel_session_id: string; qr_base64: string | null } }>(
        "/api/v1/channels/evolution",
        {},
        { idempotencyKey: chave.current },
      );
      chave.current = null;
      await carregar();
      await comecar(r.data.channel_session_id, r.data.qr_base64);
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível iniciar a conexão."));
    } finally {
      setCriando(false);
    }
  };

  const reconectar = async (s: ChannelSession) => {
    setOcupado(s.id);
    try {
      const r = await apiClient.post<{ data: { qr_base64: string | null } }>(
        `/api/v1/channels/evolution/${s.id}/reconnect`,
        {},
      );
      await carregar();
      await comecar(s.id, r.data.qr_base64);
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível reconectar."));
    } finally {
      setOcupado(null);
    }
  };

  const desconectar = async (s: ChannelSession) => {
    setOcupado(s.id);
    try {
      await apiClient.delete(`/api/v1/channel-sessions/${s.id}`);
      if (conectando === s.id) setConectando(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível desconectar."));
    } finally {
      setOcupado(null);
    }
  };

  if (!isConfigured) return null;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("WhatsApp por QR Code")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Leia o QR Code no celular para conectar um número. As mensagens entram e saem pelo CRM.")}
          </p>
        </div>
        <Button size="sm" disabled={criando} onClick={() => void conectar()}>
          {criando && <CircleNotch size={14} className="animate-spin" aria-hidden />}
          {t("Conectar via Evolution")}
        </Button>
      </div>

      {conectando && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={comoImagem(qr)}
              alt={t("QR Code para conectar WhatsApp")}
              className="h-64 w-64 rounded-md border bg-white p-2"
            />
          ) : (
            <CircleNotch size={28} className="animate-spin text-muted-foreground" aria-hidden />
          )}
          <p className="text-sm text-muted-foreground">
            {t("No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. Aponte a câmera para o QR Code.")}
          </p>
        </div>
      )}

      {conectou && !conectando && (
        <div role="status" className="flex items-center gap-2 text-sm font-medium text-success-fg">
          <CheckCircle size={20} weight="fill" aria-hidden />
          {t("Conectado!")}
        </div>
      )}

      {meus.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{channelLabel(s, t)}</span>
            <Badge variant={s.status === "WORKING" ? "secondary" : "outline"}>
              {s.status === "WORKING" && <CheckCircle size={12} weight="fill" aria-hidden />}
              {rotuloDoStatus(s.status, t)}
            </Badge>
          </div>
          {s.status === "FAILED" && s.status_reason === MOTIVO_NUMERO_EM_USO && (
            <p role="alert" className="text-sm text-error-fg">
              {t("Este número já está conectado em outra conexão.")}
            </p>
          )}
          {/* Mesmo controle dos outros canais: todo número nasce em modo de
              teste, e é aqui que se cadastram os números de teste ou se abre a
              IA ao público. */}
          <ChannelAiAccess channelId={s.id} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={ocupado === s.id} onClick={() => void reconectar(s)}>
              <ArrowsClockwise size={14} aria-hidden />
              {t("Reconectar")}
            </Button>
            <Button variant="outline" size="sm" disabled={ocupado === s.id} onClick={() => void desconectar(s)}>
              <Trash size={14} aria-hidden />
              {t("Desconectar")}
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

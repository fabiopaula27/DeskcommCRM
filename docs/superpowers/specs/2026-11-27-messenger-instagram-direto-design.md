# Messenger e Instagram Direct — conexão direta com a Meta

## Intenção
Receber no Inbox do CRM os leads que escrevem pelo Messenger da página do
Facebook e pelo Direct do Instagram, e responder de lá — sem intermediário
(Zernio) e sem mensalidade extra. Serve à operação própria e à revenda: cada
cliente conecta as próprias páginas sozinho.

## Decidido pelo usuário
- Porta **direta** com a Meta (não a Zernio).
- Conexão por **botão "Conectar com Facebook"** (login da Meta), não por token colado.
- Entregar também o passo a passo de configuração no app da Meta.

## Abordagens consideradas
1. **Login do Facebook + webhook do app (escolhida).** O cliente autoriza,
   escolhe páginas; o CRM guarda o token da página e assina os eventos. Escala
   para revenda.
2. Colar token da página. Rejeitada: técnico para o cliente, token cai quando
   a senha muda, vira retrabalho no primeiro cliente.
3. Zernio (já existe). Rejeitada pelo usuário: mensalidade e dependência.

## Como funciona (chamadas minhas, corrigíveis)
- **App da Meta:** o mesmo app da instalação (App ID, App Secret, verify token já
  usados pelo WhatsApp oficial). Faltam o App ID e o ID de configuração do
  Login, gravados pela tela de admin ou `.env` (`META_APP_ID`, `META_LOGIN_CONFIG_ID`).
- **Conectar:** Conexões › Redes sociais › "Conectar com Facebook" (owner/admin
  da organização). Login da Meta com as permissões: `pages_show_list`,
  `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`,
  `instagram_basic`, `instagram_manage_messages`, `business_management`.
  Callback troca o código por token de longa duração, lista as páginas e o
  Instagram profissional ligado a cada uma; a pessoa marca quais entram.
- **Cada página/Instagram vira um canal** (`channel_sessions`, provider novo
  `meta_messenger` / `meta_instagram`), com o token da página criptografado
  (mesma criptografia das credenciais existentes). O CRM inscreve a página no
  app (`subscribed_apps`: messages, messaging_postbacks).
- **Receber:** webhook único do app para `object=page` e `object=instagram`,
  assinatura conferida com o App Secret (como o WhatsApp oficial). A página/IG
  do evento identifica o canal e a organização. A mensagem é normalizada para o
  formato do ingest social que já existe (contato por PSID/IGSID, conversa,
  nome e foto buscados na Graph), então Inbox, funil, IA e automações funcionam
  como nos outros canais. Ecos e mensagens enviadas pela página são ignorados
  como ecos.
- **Responder:** do Inbox (texto, imagem, áudio, arquivo) pela Send API, dentro
  da janela de 24h da Meta; fora dela, o envio é recusado com aviso claro.
  O agente de IA pode atender esses canais pelo mesmo controle de acesso dos outros.
- **Saúde:** token inválido/permissão retirada → canal "desconectado" com faixa
  vermelha e botão "Reconectar", como os outros canais.
- **Desconectar:** remove a inscrição da página e arquiva o canal (histórico fica).

## Não-objetivos
- Comentários de posts e anúncios (só mensagens diretas).
- Mensagens fora da janela de 24h (tags de mensagem) — fase posterior.
- Outras redes.

## Restrições
- Até a Meta aprovar o app (App Review, acesso avançado de `pages_messaging` e
  `instagram_manage_messages`), só funciona com páginas de quem tem papel no app.
- Instagram precisa ser conta profissional ligada a uma página.
- Requer HTTPS público (já existe: solutcrm.gestordaweb.com.br).

## Entregas
Migration (providers novos e o que faltar para tokens/IDs), configuração do app
(admin), rotas de login/callback/escolha de páginas, webhook, adaptador de envio,
tela em Conexões › Redes sociais, e o guia passo a passo de configuração na Meta
(inclui o que pedir no App Review e o vídeo de demonstração).

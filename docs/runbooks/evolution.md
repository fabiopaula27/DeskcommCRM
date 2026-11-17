# Canal Evolution API (WhatsApp por QR)

O servidor Evolution é da instalação (um só para todas as organizações); cada
empresa conecta o SEU número lendo o QR em **Conexões**. O canal é opcional:
com qualquer uma das três variáveis abaixo vazia, ele não existe no app.

## 1. Subir o Evolution v2 no Easypanel

1. Crie no projeto do Easypanel um **Postgres** e um **Redis** dedicados ao Evolution.
2. Crie um serviço de app com a imagem `evoapicloud/evolution-api` (v2.x, fixe a tag).
3. Variáveis de ambiente do serviço:
   - `AUTHENTICATION_API_KEY` = uma chave longa e aleatória (é a chave global).
   - `DATABASE_ENABLED=true`, `DATABASE_PROVIDER=postgresql`, `DATABASE_CONNECTION_URI` apontando para o Postgres.
   - `CACHE_REDIS_ENABLED=true`, `CACHE_REDIS_URI` apontando para o Redis.
   - `WEBHOOK_GLOBAL_ENABLED=false`. **Nunca use webhook global**: ele mandaria as
     mensagens de todas as organizações para um único endereço. O CRM registra
     um webhook próprio, com segredo, em cada instância.
4. Exponha a porta 8080 com domínio e HTTPS (ex.: `https://evolution.seudominio.com`).

## 2. Variáveis do CRM

| Variável | Valor |
|---|---|
| `EVOLUTION_API_URL` | URL base do servidor Evolution |
| `EVOLUTION_API_KEY` | o mesmo `AUTHENTICATION_API_KEY` do servidor |
| `EVOLUTION_WEBHOOK_BASE_URL` | endereço **público e fixo** deste app (ex.: `https://crm.seudominio.com`) |

Atenção: o `EVOLUTION_WEBHOOK_BASE_URL` precisa ser alcançável pelo servidor
Evolution e não pode mudar. Um túnel `trycloudflare` muda de URL a cada
reinício e quebra os webhooks de todas as instâncias já conectadas (elas
guardam a URL antiga). Em desenvolvimento, use um túnel nomeado, não o efêmero.
Depois de alterar as variáveis, reinicie o app.

## 3. Conectar um número

1. Em **Conexões**, escolha o canal Evolution (WhatsApp por QR) e crie a conexão.
2. Leia o QR com o WhatsApp do número: Aparelhos conectados > Conectar aparelho.
3. Aguarde o status **WORKING** (conectado). O histórico antigo do aparelho não
   vira lead; só mensagens novas entram.
4. Para trocar o número ou desligar, use desconectar na mesma tela. Isso afeta
   somente aquela instância.

Um mesmo número não pode estar ativo em duas organizações: a segunda tentativa
falha com "número em uso". Conexões antigas paradas (STOPPED/FAILED) com o
mesmo número não bloqueiam a reconexão.

> **Atenção — mensagens durante a queda:** a cada reconexão o carimbo de
> conexão (`connected_at`) é renovado. Mensagens que ficaram na fila do aparelho
> enquanto a instância estava desconectada chegam com hora ANTERIOR à nova
> conexão, são tratadas como histórico e **não são ingeridas**. Depois de uma
> queda, confira no próprio WhatsApp as conversas do período.

## 4. Problemas comuns

- **Mensagens não chegam**: confira (a) o status da conexão é WORKING; (b) o
  `EVOLUTION_WEBHOOK_BASE_URL` é a URL pública atual do app e responde de fora
  (o servidor Evolution consegue abri-la); (c) o header de segredo enviado pelo
  Evolution bate com o da conexão (reconectar a instância regrava webhook e
  segredo); (d) nos logs do Evolution, a entrega do webhook não retorna 401/404.
- **"Número em uso"**: o número já está conectado em outra organização (ou em
  outra conexão desta). Desconecte lá primeiro.
- **QR não aparece / expira**: gere de novo; se persistir, confira
  `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` e os logs do Evolution.
- **Canal não aparece em Conexões**: alguma das três variáveis está vazia.

## 5. Fixtures sintéticas (importante)

Os payloads de teste em `lib/channels/evolution/__fixtures__/` são **sintéticos**,
escritos a partir da documentação, não capturados de um servidor real (ver o
`README.md` dessa pasta). Na primeira instalação real, capture payloads reais
(mensagem de texto, mídia, ack, mudança de conexão), compare com as fixtures e,
se diferirem, ajuste o parser e as fixtures.

## 6. Teste de aceitação (rodar na primeira instalação real)

Requer um servidor Evolution no ar, duas organizações e dois celulares com WhatsApp.
Não foi executado no desenvolvimento (sem servidor nem aparelhos no ambiente).

- [ ] Conectar o número A na organização 1 e o número B na organização 2; ambos chegam a WORKING.
- [ ] Mensagem de um terceiro para A aparece só na organização 1; para B, só na organização 2.
- [ ] Mensagens cruzadas A <-> B chegam cada uma na sua organização, sem vazar para a outra.
- [ ] Resposta enviada pelo CRM em cada organização sai do número correto.
- [ ] Desconectar A não afeta B (B continua recebendo e enviando).
- [ ] O histórico antigo do aparelho conectado não cria leads.
- [ ] Tentar conectar o número A também na organização 2 falha com "número em uso".
- [ ] Payloads reais capturados e conferidos contra as fixtures (seção 5).

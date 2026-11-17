# Fixtures da Evolution API (SINTETICAS)

**Atencao: estas fixtures sao SINTETICAS.** Nao foram capturadas de um servidor real.
Foram montadas a partir da documentacao e do codigo-fonte da Evolution API v2.2.x
(sem Docker nem telefone pareavel no ambiente de desenvolvimento). **A captura real
continua pendente**: quando houver servidor + numero de teste, regrave cada arquivo
com o corpo cru do webhook e atualize esta pagina.

- Versao de referencia / minima suportada: **Evolution API v2.2.3** (`atendai/evolution-api:v2.2.3`)
- Dados ficticios: telefone `5511999990001`, nome `Contato Teste`, grupo `120363000000000000@g.us`, base64 minusculo falso.

## Fontes consultadas (tag 2.2.3 do repositorio EvolutionAPI/evolution-api)
- https://raw.githubusercontent.com/EvolutionAPI/evolution-api/2.2.3/src/api/types/wa.types.ts (enum `Events`: valores minusculos com ponto, ex. `messages.upsert`, `connection.update`, `qrcode.updated`)
- https://raw.githubusercontent.com/EvolutionAPI/evolution-api/2.2.3/src/api/integrations/event/webhook/webhook.controller.ts (envelope: `event, instance, data, destination, date_time, sender, server_url, apikey`)
- https://raw.githubusercontent.com/EvolutionAPI/evolution-api/2.2.3/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts (payloads de `messages.upsert` via `prepareMessage`, `messages.update`, `connection.update`, `qrcode.updated`)
- https://raw.githubusercontent.com/EvolutionAPI/evolution-api/2.2.3/src/api/controllers/instance.controller.ts (resposta do create instance)
- A documentacao https://doc.evolution-api.com/v2 nao pode ser lida (404 nas paginas tentadas).

## Pontos incertos (conferir na captura real)
- `send-text-response` e `messages-update-ack` (`status` textual, `participant`) foram deduzidos do codigo; formato exato nao verificado.
- **Posicao do base64 de midia INCERTA**: as fixtures usam `data.message.base64`; a v2.2.3 real pode usar `data.base64`. Confirmar na captura real (o parser aceitara ambos). So vem com `webhookBase64: true` na instancia.
- O base64 de audio e documento sao placeholders, nao arquivos validos.
- O `base64` do QR e uma imagem 1x1 falsa.
- `connection-update-close` usa `statusReason: 401` (logout); outros codigos existem.

## Arquivos e como gerar o equivalente real
Instancia: `POST /instance/create` com `integration: "WHATSAPP-BAILEYS"`, `qrcode: true`, `webhook: { url, byEvents: false, base64: true, events: ["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE","QRCODE_UPDATED"] }`.
- `instance-create-response`: resposta do `POST /instance/create`.
- `qrcode-updated`: evento `QRCODE_UPDATED` logo apos criar/conectar.
- `connection-update-open` / `-close`: parear o numero / desconectar o aparelho (ou `DELETE /instance/logout/{instance}`).
- `messages-upsert-text|image|audio|document`: contato envia o tipo de mensagem ao numero pareado.
- `messages-upsert-fromme`: enviar mensagem pelo proprio celular (app WhatsApp).
- `messages-upsert-group`: mensagem em um grupo (requer `groupsIgnore: false`).
- `messages-update-ack`: evento `MESSAGES_UPDATE` apos o contato ler uma mensagem enviada.
- `send-text-response`: resposta de `POST /message/sendText/{instance}` com `{ number, text }`.

Servidor de teste: `docker compose -f docker-compose.evolution-dev.yml up -d` (porta 8085, apikey `evolution-dev-key-local`).

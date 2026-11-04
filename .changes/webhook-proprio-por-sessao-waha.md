---
impacto: capacidade_nova
secao: corrigido
titulo: Mais de um número no mesmo WAHA externo deixa de entregar mensagem na organização errada
---
Com o WAHA fora da rede do app, um único `WHATSAPP_HOOK_URL` com token fazia as mensagens de todos os números caírem na organização dona daquele token. Agora a rota por token recusa evento de outra sessão, e a nova variável opcional `WAHA_WEBHOOK_SESSION_BASE_URL` dá a cada sessão o seu próprio webhook ao conectar ou reconectar. Quem usa o compose padrão não precisa fazer nada.

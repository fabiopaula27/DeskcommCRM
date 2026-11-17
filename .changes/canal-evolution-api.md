---
impacto: capacidade_nova
secao: adicionado
titulo: Novo canal de WhatsApp por QR via Evolution API (servidor próprio)
---
Quem hospeda um servidor Evolution API v2 pode agora oferecer o WhatsApp por QR como um canal à parte, ao lado do WAHA e da API oficial. Cada empresa conecta o seu número lendo o QR na tela de Conexões, com webhook próprio por instância, e o mesmo número não pode ser usado em duas organizações. O canal só aparece quando as variáveis `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_WEBHOOK_BASE_URL` estão preenchidas; quem não usa não precisa fazer nada. O passo a passo está em `docs/runbooks/evolution.md`.

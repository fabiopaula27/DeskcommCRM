# Messenger e Instagram Direct no CRM — passo a passo

Conexão **direta** com a Meta: as mensagens da página do Facebook (Messenger) e
do Instagram profissional chegam no Inbox, e a equipe responde por lá.

Troque `SEU-DOMINIO` pelo endereço do CRM (ex.: `solutcrm.gestordaweb.com.br`).

---

## 0. Antes de começar

- Um **app da Meta** do tipo **Empresa** em <https://developers.facebook.com/apps>
  (pode ser o mesmo do WhatsApp oficial).
- O app ligado ao seu **Portfólio empresarial** (Business Manager).
- A **página do Facebook** e o **Instagram profissional** (Comercial ou Criador)
  **ligados um ao outro**: no Instagram › Configurações › Central de contas, ou
  na página › Configurações › Contas vinculadas › Instagram.
- No Instagram: Configurações › Privacidade › Mensagens › **Permitir acesso às
  mensagens** (ferramentas conectadas) ligado.
- Você precisa ter **papel no app** (administrador/desenvolvedor) — até a Meta
  aprovar o app, só funciona com páginas de quem tem papel nele.

## 1. Dados básicos do app

App › **Configurações do app › Básico**:

| Campo | Valor |
|---|---|
| Domínios do app | `SEU-DOMINIO` |
| URL da Política de Privacidade | `https://SEU-DOMINIO/politica-de-privacidade/` |
| URL dos Termos de Serviço | `https://SEU-DOMINIO/termos-de-servico/` |
| Ícone, categoria, e-mail de contato | preencher |

Anote o **ID do app** e a **Chave secreta do app** (botão "Mostrar").

## 2. Adicionar os produtos

Em **Casos de uso** (ou "Adicionar produto"):

1. **Messenger** — "Interagir com clientes no Messenger".
2. **Instagram** — "Gerenciar mensagens e conteúdo no Instagram" (API do
   Instagram **com login do Facebook**).
3. **Login do Facebook para Empresas**.

## 3. Login do Facebook para Empresas (gera o ID de configuração)

**Login do Facebook para Empresas › Configurações**:

- **URIs de redirecionamento do OAuth válidos**:
  `https://SEU-DOMINIO/api/v1/channels/meta-social/callback`
- "Login do OAuth do cliente" e "Login do OAuth da Web": **Sim**.
- "Usar modo estrito para URIs de redirecionamento": **Sim**.

**Login do Facebook para Empresas › Configurações (Configurations) › Criar configuração**:

- Nome: `CRM - Messenger e Instagram`
- Tipo de token: **Token de acesso do usuário**
- Ativos: **Páginas** e **Contas do Instagram**
- Permissões: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`,
  `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`,
  `business_management`
- Salvar → anote o **ID da configuração**.

## 4. Webhooks

**Webhooks** (ou Messenger › Configurações da API › Webhooks):

1. Objeto **Page** → "Assinar este objeto":
   - URL de retorno: `https://SEU-DOMINIO/api/v1/webhooks/meta-social`
   - Token de verificação: o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN` (passo 5)
   - Campos: **messages**, **messaging_postbacks**, **message_echoes**
2. Objeto **Instagram** → mesma URL e mesmo token:
   - Campos: **messages**, **messaging_postbacks**

> Salve o webhook **depois** de implantar o CRM com as variáveis do passo 5 —
> a Meta testa a URL na hora.

O CRM inscreve cada página no app sozinho quando você conecta (não precisa
clicar em "Adicionar assinaturas" por página).

## 5. Variáveis no Easypanel

Easypanel › projeto **automacao** › serviço **crm › app** › **Ambiente**:

```
META_APP_ID=<ID do app>
META_LOGIN_CONFIG_ID=<ID da configuração do passo 3>
META_APP_SECRET=<Chave secreta do app>
META_WEBHOOK_VERIFY_TOKEN=<uma senha longa que você inventa>
```

`META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN` podem já existir (WhatsApp
oficial) — **use os mesmos**, é o mesmo app. Depois: **Implantar**.

## 6. Banco

Rode no Supabase Studio o SQL da migration
`20261127180000_9116_canal_meta_social.sql`.

## 7. Conectar

CRM › **Conexões › Redes sociais › Conectar com Facebook** (dono ou
administrador):

1. Entre com o Facebook que administra a página.
2. Escolha **as páginas e os Instagrams** que entram no CRM.
3. Confirme as permissões.
4. Volta para Conexões com "Conectado: N canal(is)".

Cada página vira um canal **Messenger** e cada Instagram ligado vira um canal
**Instagram**. "Desconectar" tira o canal (o histórico fica).

## 8. Testar

- De **outra** conta do Facebook/Instagram (não a da página), mande uma
  mensagem para a página e para o Instagram.
- A conversa aparece no **Inbox** com o nome da pessoa. Responda por lá.
- Regra da Meta: só dá para responder até **24h** depois da última mensagem
  do lead. Fora disso o CRM avisa e não envia.

Se não chegar: confira o webhook (passo 4) — a Meta mostra erros em
Webhooks › "Testar" — e se o Instagram permite acesso às mensagens (passo 0).

## 9. Liberar para clientes (Análise do app)

Enquanto o app está em desenvolvimento, só páginas de pessoas com papel no app
funcionam. Para clientes:

1. **Verificação da empresa** no Portfólio empresarial (documentos do CNPJ).
2. App › **Análise do app › Permissões e recursos** → pedir **Acesso avançado**
   para: `pages_messaging`, `instagram_manage_messages`,
   `pages_manage_metadata`, `pages_show_list`, `instagram_basic`,
   `pages_read_engagement`, `business_management`.
3. Para cada permissão, explicar o uso. Texto sugerido:

   > Nosso CRM permite que empresas recebam e respondam, em uma caixa de entrada
   > única, as mensagens que clientes enviam à página do Facebook (Messenger) e ao
   > Instagram profissional da empresa. A empresa conecta a própria página pelo
   > Login do Facebook, escolhe as páginas e contas do Instagram, e a equipe lê e
   > responde as conversas dentro do CRM. Só respondemos dentro da janela de 24
   > horas e não enviamos mensagens em massa.

4. **Vídeo de demonstração** (um por permissão, ou um que mostre tudo), gravado
   com uma conta de teste:
   1. Entrar no CRM e abrir Conexões › Redes sociais.
   2. Clicar em "Conectar com Facebook", mostrar a janela da Meta com as
      permissões, escolher a página e o Instagram, confirmar.
   3. Mostrar os canais "recebendo".
   4. De outra conta, mandar mensagem no Messenger e no Instagram.
   5. Mostrar as mensagens chegando no Inbox e responder.
   6. Mostrar a resposta chegando no Messenger/Instagram.
5. Instruções de teste para o revisor: um usuário de teste do CRM (e-mail e
   senha) e a página de teste.
6. Enviar. Prazo típico: de alguns dias a 4 semanas. Depois de aprovado, mude o
   app para o modo **Ao vivo**.

# smartgr-agenda-tecnicas

Sistema de gerenciamento de solicitações de treinamento de técnicas de estética da SmartGR. Projeto independente — não reutiliza código do Portal de Eventos nem do Portal de Baixa de Estoque, apenas o mesmo padrão arquitetural (Vite + Vanilla JS, Firebase Auth/Firestore, Cloudflare Pages/Workers, Resend).

## Stack

- Frontend: Vite + Vanilla JS, hospedado no Cloudflare Pages
- Auth: Firebase Authentication (Google Sign-In restrito a `@smartgr.com.br`)
- Banco: Firestore
- Backend/API: Cloudflare Workers (`workers/api`, `workers/calendar`, `workers/email`)
- E-mail transacional: Resend (Fase 2)
- Fonte: DM Sans · Cores: azul `#385384`, rosa hover `#FF228B`

## Estrutura

```
smartgr-agenda-tecnicas/
├── frontend/            Vite + Vanilla JS (portal de vendedores e Julia)
├── workers/
│   ├── api/              esqueleto (Fase 2)
│   ├── calendar/          OAuth Google Calendar + criação de evento (Fase 2)
│   └── email/             envio via Resend (Fase 2)
├── scripts/
│   └── seed-tecnicas.mjs  seed inicial da coleção `tecnicas`
├── firestore.rules
├── firestore.indexes.json
└── README.md
```

## Rodando localmente

```bash
cd frontend
npm install
cp .env.example .env      # preencher com as chaves do projeto Firebase
npm run dev
```

Acesse `http://localhost:5173`.

## Variáveis de ambiente (frontend/.env)

| Variável | Descrição |
|---|---|
| `VITE_FIREBASE_API_KEY` | Config do app Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | Config do app Firebase |
| `VITE_FIREBASE_PROJECT_ID` | Config do app Firebase |
| `VITE_FIREBASE_STORAGE_BUCKET` | Config do app Firebase |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Config do app Firebase |
| `VITE_FIREBASE_APP_ID` | Config do app Firebase |
| `VITE_ALLOWED_EMAIL_DOMAIN` | Domínio permitido no login (`smartgr.com.br`) |
| `VITE_API_WORKER_URL` | URL do worker `api` (ainda não usada na Fase 1) |
| `VITE_CALENDAR_WORKER_URL` | URL do worker `calendar` (ainda não usada na Fase 1) |

## Seed da coleção `tecnicas`

```bash
cd scripts
npm install
export GOOGLE_APPLICATION_CREDENTIALS=/caminho/para/service-account.json
npm run seed:tecnicas
```

Cria os 5 documentos fixos (Fernanda Borba, Mariana Cruz, Vithoria Zanotti, Eloah Ramos, Julia Ruiz) com `ativo: true`, `conectadoEm: null` e sem token — a conexão real da agenda é Fase 2.

## Deploy

- Frontend: Cloudflare Pages, deploy via `git push` (build command `npm run build`, output `frontend/dist`, root directory `frontend`).
- Workers: `wrangler deploy` dentro de cada pasta em `workers/*` (Fase 2, quando a lógica for implementada).

## Regras de negócio implementadas na Fase 1

- SLA de aprovação: 24 horas úteis (`calcularSlaUteis` em `frontend/src/utils/sla.js`), considerando expediente 08h-18h, sem contar fins de semana.
- Prioridade entre solicitações concorrentes é sempre manual — Julia decide na hora de aprovar. Nenhuma regra automática de priorização.
- Consumidor Final: trava mútua entre modalidade e tipo de treinamento — `externo` nunca é `online`; `online` sempre é `interno`.
- Consumidor Final `externo`: sinalização apenas, sem tarefa automática (fluxo operacional roda em outro portal).
- Workshop tem data única (sem as 4 opções de data que Consumidor Final e Revenda têm).
- Julia vê e pode agir sobre todas as solicitações pendentes das 3 origens, em uma fila só, independente de quem criou (Painel — Julia consulta as 3 coleções sem filtro por vendedor).
- Firestore rules: acesso de leitura/escrita restrito a usuários autenticados com e-mail `@smartgr.com.br`. Nenhum acesso anônimo.

## O que falta para a Fase 2

- Tela "Conectar minha agenda" da técnica (`frontend/src/pages/conectar-agenda-tecnica.js`): hoje é só um placeholder público. Falta o fluxo OAuth do Google Calendar (escopo `https://www.googleapis.com/auth/calendar.events`), salvar `refreshTokenEncrypted` (criptografado) e `conectadoEm` no documento da técnica.
- Worker `workers/calendar`: criar evento na Google Agenda individual da técnica automaticamente quando a Julia aprova uma solicitação e atribui a técnica.
- Worker `workers/email` + Resend:
  - Notificação para a Nayra quando Consumidor Final for `interno` + `presencial` (preparo do coffee). `interno` + `online` não aciona.
  - Notificação ao vendedor/técnica quando a solicitação é aprovada (data confirmada + técnica atribuída) ou recusada.
- Criptografia real do `refreshTokenEncrypted` (hoje o seed grava `null`; nunca gravar token em texto puro).
- Endpoints do `workers/api`, se necessário centralizar lógica de aprovação fora do cliente (hoje as escritas de aprovação/recusa são feitas direto do frontend para o Firestore).

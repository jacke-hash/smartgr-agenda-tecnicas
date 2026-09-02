/**
 * Fase 2: OAuth do Google Calendar (escopo calendar.events) por técnica
 * e criação automática de evento na agenda individual ao aprovar solicitação.
 */
import { buildGoogleAuthUrl, exchangeCodeForTokens, refreshAccessToken, getGoogleUserInfo } from './googleAuth.js';
import { findTecnicaByEmail, getTecnica, patchTecnica, listAprovadasPorTecnica } from './firestoreRest.js';
import { encryptSecret, decryptSecret, signState, verifyState } from './crypto.js';
import { corsHeaders, handlePreflight } from './cors.js';

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

const TIPO_LABEL = {
  consumidor_final: 'Consumidor Final',
  revenda: 'Revendas/Redes',
  workshop: 'Workshop'
};

const COLECOES_SOLICITACOES = ['solicitacoes_consumidor_final', 'solicitacoes_revenda', 'solicitacoes_workshop'];

// "Local de trabalho" e aniversário automático de contato são recursos do
// Google Calendar só informativos — nunca representam indisponibilidade
// real nem são um "evento" que a Julia precisa ver na escala. Compartilhado
// entre a checagem de conflito e a listagem de eventos reais da técnica.
const TIPOS_EVENTO_IGNORADOS = new Set(['workingLocation', 'birthday']);

// Reunião de equipe (principalmente as que têm link de Google Meet) não é um
// compromisso que ocupa a técnica pra treinamento — é sync interno, curto,
// não representa indisponibilidade real. `hangoutLink`/`conferenceData` é o
// jeito confiável de detectar isso na API do Google (não dá pra confiar no
// título do evento). Mesmo critério usado tanto pra checar conflito quanto
// pra sugerir datas disponíveis.
function eventoIgnoravelParaDisponibilidade(evento) {
  return TIPOS_EVENTO_IGNORADOS.has(evento.eventType) || Boolean(evento.hangoutLink || evento.conferenceData);
}

function json(data, status, headers) {
  return Response.json(data, { status: status || 200, headers });
}

function redirectParaFrontend(origin, status, motivo) {
  const params = new URLSearchParams({ status });
  if (motivo) params.set('motivo', motivo);
  return Response.redirect(`${origin}/#/conectar-agenda?${params.toString()}`, 302);
}

function formatEndereco(endereco) {
  if (!endereco) return null;
  return [
    `${endereco.rua || ''}, ${endereco.numero || ''}`,
    endereco.complemento,
    endereco.bairro,
    `${endereco.cidade || ''}/${endereco.uf || ''}`
  ]
    .filter(Boolean)
    .join(' — ');
}

// Linhas extras da descrição do evento — o que a técnica realmente precisa
// pra se preparar (quem é o cliente, o equipamento, o local/unidade), não só
// tipo/solicitante. Espelha (em texto puro, pro corpo do evento do Calendar)
// os mesmos campos que workers/email formata em HTML — duplicação
// consciente, contexto de renderização diferente.
function formatarDescricaoSolicitacao(tipo, s) {
  if (!s) return [];

  if (tipo === 'consumidor_final') {
    const participantes = (s.participantes || []).map((p) => `${p.nome} (${p.profissao})`).join(', ');
    return [
      participantes ? `Cliente(s): ${participantes}` : null,
      s.equipamentoComprado ? `Equipamento: ${s.equipamentoComprado}${s.numeroSerie ? ` — nº série ${s.numeroSerie}` : ''}` : null,
      s.unidade ? `Unidade: ${s.unidade}` : null,
      s.perfilProfissional ? `Perfil do profissional: ${s.perfilProfissional}` : null,
      s.contato ? `Contato: ${s.contato}` : null,
      s.insumosAdquiridos ? `Insumos: ${s.insumosAdquiridos}` : null,
      s.observacao ? `Observação: ${s.observacao}` : null
    ];
  }

  if (tipo === 'revenda' && s.destinoTreinamento === 'cliente_revenda') {
    return [
      s.nomeRevenda ? `Revenda/Rede: ${s.nomeRevenda}` : null,
      `Destino: Cliente da revenda`,
      s.tipoTreinamentoCliente ? `Tipo de treinamento: ${s.tipoTreinamentoCliente === 'online' ? 'Online' : 'Presencial'}` : null,
      s.nomeTreinamentoCliente ? `Treinamento: ${s.nomeTreinamentoCliente}` : null,
      s.equipamentoCliente ? `Equipamento: ${s.equipamentoCliente}` : null,
      s.insumosCliente ? `Insumos: ${s.insumosCliente}` : null,
      s.transporteCliente ? `Transporte: ${s.transporteCliente}` : null,
      s.observacoesCliente ? `Observações: ${s.observacoesCliente}` : null
    ];
  }

  if (tipo === 'revenda') {
    return [
      s.nomeRevenda ? `Revenda/Rede: ${s.nomeRevenda}` : null,
      s.tema ? `Tema: ${s.tema}` : null,
      `Destino: Equipe própria`
    ];
  }

  if (tipo === 'workshop') {
    return [
      s.localInstituicao ? `Instituição: ${s.localInstituicao}` : null,
      s.tema ? `Tema: ${s.tema}` : null,
      s.publico ? `Público: ${s.publico}` : null,
      s.participantesEstimados != null ? `Participantes estimados: ${s.participantesEstimados}` : null,
      s.responsavelLocal?.nome ? `Responsável local: ${s.responsavelLocal.nome} (${s.responsavelLocal.contato || '—'})` : null
    ];
  }

  return [];
}

async function handleOauthIniciar(url, env, headers) {
  const origin = url.searchParams.get('origin');
  if (!origin) return json({ status: 'error', message: 'origin é obrigatório' }, 400, headers);

  const state = await signState({ origin, ts: Date.now() }, env.TOKEN_ENCRYPTION_KEY);
  return Response.redirect(buildGoogleAuthUrl(env, state), 302);
}

async function handleOauthCallback(url, env, headers) {
  const stateToken = url.searchParams.get('state');
  const state = await verifyState(stateToken, env.TOKEN_ENCRYPTION_KEY, STATE_MAX_AGE_MS);
  if (!state) return json({ status: 'error', message: 'state inválido ou expirado' }, 400, headers);

  const code = url.searchParams.get('code');
  if (!code) return redirectParaFrontend(state.origin, 'erro', 'sem_code');

  try {
    console.log('oauth/callback: trocando code por tokens...');
    const tokens = await exchangeCodeForTokens(env, code);
    console.log('oauth/callback: tokens recebidos, tem refresh_token?', Boolean(tokens.refresh_token));
    if (!tokens.refresh_token) {
      return redirectParaFrontend(state.origin, 'erro', 'sem_refresh_token');
    }

    console.log('oauth/callback: buscando userinfo...');
    const userInfo = await getGoogleUserInfo(tokens.access_token);
    console.log('oauth/callback: userinfo recebido, email:', userInfo.email, 'verified:', userInfo.email_verified);
    if (!userInfo.email || !userInfo.email_verified || !userInfo.email.endsWith('@smartgr.com.br')) {
      return redirectParaFrontend(state.origin, 'erro', 'conta_invalida');
    }

    console.log('oauth/callback: buscando técnica no Firestore por email...');
    const tecnica = await findTecnicaByEmail(env, userInfo.email);
    console.log('oauth/callback: técnica encontrada?', Boolean(tecnica), tecnica?.id);
    if (!tecnica) return redirectParaFrontend(state.origin, 'erro', 'tecnica_nao_encontrada');

    console.log('oauth/callback: criptografando refresh token e gravando no Firestore...');
    const refreshTokenEncrypted = await encryptSecret(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY);
    await patchTecnica(env, tecnica.id, { refreshTokenEncrypted, conectadoEm: new Date() });
    console.log('oauth/callback: sucesso, técnica atualizada.');

    return redirectParaFrontend(state.origin, 'sucesso');
  } catch (err) {
    console.error('oauth/callback: exceção não tratada:', err.stack || err.message || err);
    return redirectParaFrontend(state.origin, 'erro', 'falha_interna');
  }
}

function montarDescricaoEvento(tipo, tipoTreinamento, nomeSolicitante, solicitacao) {
  const tipoLabel = TIPO_LABEL[tipo] || tipo;
  return [
    `Tipo: ${tipoLabel}`,
    tipoTreinamento ? `Treinamento: ${tipoTreinamento === 'interno' ? 'Interno' : 'Externo'}` : null,
    `Solicitante: ${nomeSolicitante}`,
    ...formatarDescricaoSolicitacao(tipo, solicitacao)
  ]
    .filter(Boolean)
    .join('\n');
}

function montarEventBody({ tipo, tipoTreinamento, tipoReserva, modalidade, endereco, unidade, nomeSolicitante, dataHora, solicitacao }) {
  const tipoLabel = TIPO_LABEL[tipo] || tipo;
  const ehPeriodo = tipoReserva === 'periodo';
  // Treinamento interno (consumidor_final) não tem endereço — o local é a
  // própria unidade SmartGR selecionada no formulário (ex: "Zona Sul"), não
  // um endereço de cliente. Sem isso, location caía sempre em "A confirmar"
  // mesmo já sabendo exatamente onde é.
  const location = modalidade === 'online' ? 'Online' : unidade || formatEndereco(endereco) || 'A confirmar';

  return {
    summary: `Treinamento ${tipoLabel} — ${nomeSolicitante}`,
    description: montarDescricaoEvento(tipo, tipoTreinamento, nomeSolicitante, solicitacao),
    location,
    start: ehPeriodo
      ? { dateTime: `${dataHora.dataInicio}T${dataHora.horaInicio}:00`, timeZone: 'America/Sao_Paulo' }
      : { dateTime: `${dataHora.data}T${dataHora.horaInicio}:00`, timeZone: 'America/Sao_Paulo' },
    end: ehPeriodo
      ? { dateTime: `${dataHora.dataFim}T${dataHora.horaTermino}:00`, timeZone: 'America/Sao_Paulo' }
      : { dateTime: `${dataHora.data}T${dataHora.horaTermino}:00`, timeZone: 'America/Sao_Paulo' }
  };
}

async function handleCriarEvento(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'body inválido' }, 400, headers);
  }

  const { tecnicaId, tipo, tipoTreinamento, tipoReserva, modalidade, endereco, unidade, nomeSolicitante, dataHora, solicitacao } = body;
  const ehPeriodo = tipoReserva === 'periodo';
  const camposDataOk = ehPeriodo
    ? Boolean(dataHora?.dataInicio && dataHora?.dataFim && dataHora?.horaInicio && dataHora?.horaTermino)
    : Boolean(dataHora?.data && dataHora?.horaInicio && dataHora?.horaTermino);
  if (!tecnicaId || !tipo || !nomeSolicitante || !camposDataOk) {
    return json({ status: 'error', message: 'campos obrigatórios ausentes' }, 400, headers);
  }

  const tecnica = await getTecnica(env, tecnicaId);
  if (!tecnica) return json({ status: 'error', message: 'técnica não encontrada' }, 404, headers);
  if (!tecnica.refreshTokenEncrypted) {
    return json({ status: 'error', message: 'técnica ainda não conectou a agenda' }, 409, headers);
  }

  const refreshToken = await decryptSecret(tecnica.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
  console.log('criar-evento: refresh token decriptado, trocando por access token...');
  const { access_token: accessToken } = await refreshAccessToken(env, refreshToken);
  console.log('criar-evento: access token obtido, chamando Calendar API...');

  const eventBody = montarEventBody({ tipo, tipoTreinamento, tipoReserva, modalidade, endereco, unidade, nomeSolicitante, dataHora, solicitacao });

  const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody)
  });

  if (!resp.ok) {
    const corpoErro = await resp.text();
    console.error(`criar-evento: Calendar API respondeu ${resp.status}`, corpoErro, 'eventBody enviado:', JSON.stringify(eventBody));
    return json({ status: 'error', message: `Falha ao criar evento: ${corpoErro}` }, 502, headers);
  }

  const evento = await resp.json();
  console.log('criar-evento: evento criado com sucesso', evento.id);
  return json({ status: 'ok', eventId: evento.id, htmlLink: evento.htmlLink }, 200, headers);
}

// --- Escala geral (painel da Julia) ---
// Evento/local de texto livre — não é uma solicitação (sem tipo/tipoTreinamento
// /solicitacao), então não passa por montarEventBody. Mesma mecânica de
// decriptar refresh token → trocar por access token que handleCriarEvento já
// usa, só o eventBody é montado direto dos campos da escala.
async function acessoTecnicaOuErro(env, tecnicaId, headers) {
  const tecnica = await getTecnica(env, tecnicaId);
  if (!tecnica) return { erro: json({ status: 'error', message: 'técnica não encontrada' }, 404, headers) };
  if (!tecnica.refreshTokenEncrypted) {
    return { erro: json({ status: 'error', message: 'técnica ainda não conectou a agenda' }, 409, headers) };
  }
  const refreshToken = await decryptSecret(tecnica.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
  const { access_token: accessToken } = await refreshAccessToken(env, refreshToken);
  return { accessToken };
}

function montarEventBodyEscala({ evento, local, data, horarioInicio, horarioFim }) {
  return {
    summary: evento,
    location: local || 'A confirmar',
    start: { dateTime: `${data}T${horarioInicio}:00`, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: `${data}T${horarioFim}:00`, timeZone: 'America/Sao_Paulo' }
  };
}

async function handleEscalaCriarEvento(request, env, headers) {
  const body = await request.json();
  const { tecnicaId, evento, local, data, horarioInicio, horarioFim } = body;
  if (!tecnicaId || !evento || !data || !horarioInicio || !horarioFim) {
    return json({ status: 'error', message: 'campos obrigatórios ausentes' }, 400, headers);
  }

  const { accessToken, erro } = await acessoTecnicaOuErro(env, tecnicaId, headers);
  if (erro) return erro;

  const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(montarEventBodyEscala({ evento, local, data, horarioInicio, horarioFim }))
  });
  if (!resp.ok) {
    return json({ status: 'error', message: `Falha ao criar evento: ${await resp.text()}` }, 502, headers);
  }
  const criado = await resp.json();
  return json({ status: 'ok', eventId: criado.id, htmlLink: criado.htmlLink }, 200, headers);
}

async function handleEscalaAtualizarEvento(request, env, headers) {
  const body = await request.json();
  const { tecnicaId, eventId, evento, local, data, horarioInicio, horarioFim } = body;
  if (!tecnicaId || !eventId || !evento || !data || !horarioInicio || !horarioFim) {
    return json({ status: 'error', message: 'campos obrigatórios ausentes' }, 400, headers);
  }

  const { accessToken, erro } = await acessoTecnicaOuErro(env, tecnicaId, headers);
  if (erro) return erro;

  const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(montarEventBodyEscala({ evento, local, data, horarioInicio, horarioFim }))
  });
  if (!resp.ok) {
    return json({ status: 'error', message: `Falha ao atualizar evento: ${await resp.text()}` }, 502, headers);
  }
  const atualizado = await resp.json();
  return json({ status: 'ok', eventId: atualizado.id, htmlLink: atualizado.htmlLink }, 200, headers);
}

async function handleEscalaExcluirEvento(request, env, headers) {
  const body = await request.json();
  const { tecnicaId, eventId } = body;
  if (!tecnicaId || !eventId) {
    return json({ status: 'error', message: 'campos obrigatórios ausentes' }, 400, headers);
  }

  const { accessToken, erro } = await acessoTecnicaOuErro(env, tecnicaId, headers);
  if (erro) return erro;

  const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  // 404/410 = já não existe mais — objetivo alcançado, não é erro.
  if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
    return json({ status: 'error', message: `Falha ao excluir evento: ${await resp.text()}` }, 502, headers);
  }
  return json({ status: 'ok' }, 200, headers);
}

// Google não avisa o worker quando um evento é apagado direto na agenda da
// técnica (sem webhook/push notification configurado — over-engineering pro
// tamanho desse time). Em vez disso, o painel de Escala rechecha, toda vez
// que carrega uma semana, se os eventos que ele acha que existem realmente
// ainda existem — se a técnica apagou manualmente, o item some do painel
// também (e não só o evento "fantasma" ficando esquecido lá).
async function handleEscalaVerificarEventos(request, env, headers) {
  const body = await request.json();
  const itens = Array.isArray(body?.itens) ? body.itens : [];
  if (itens.length === 0) return json({ status: 'ok', resultados: [] }, 200, headers);

  const accessTokenPorTecnica = {};
  async function accessTokenDe(tecnicaId) {
    if (!(tecnicaId in accessTokenPorTecnica)) {
      try {
        const tecnica = await getTecnica(env, tecnicaId);
        if (!tecnica?.refreshTokenEncrypted) throw new Error('sem agenda conectada');
        const refreshToken = await decryptSecret(tecnica.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
        accessTokenPorTecnica[tecnicaId] = (await refreshAccessToken(env, refreshToken)).access_token;
      } catch (err) {
        accessTokenPorTecnica[tecnicaId] = null;
      }
    }
    return accessTokenPorTecnica[tecnicaId];
  }

  const resultados = await Promise.all(
    itens.map(async ({ tecnicaId, eventId }) => {
      const accessToken = await accessTokenDe(tecnicaId);
      // Sem acesso à agenda dela (desconectou, erro) — não dá pra confirmar
      // nada, então assume que o evento ainda existe (não apaga sem certeza).
      if (!accessToken) return { tecnicaId, eventId, existe: true };

      try {
        const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (resp.status === 404 || resp.status === 410) return { tecnicaId, eventId, existe: false };
        if (!resp.ok) return { tecnicaId, eventId, existe: true };
        const evento = await resp.json();
        // Cancelado (apagado mas ainda retornável por um tempo via sync) conta
        // como "não existe mais" pro nosso propósito.
        return { tecnicaId, eventId, existe: evento.status !== 'cancelled' };
      } catch {
        return { tecnicaId, eventId, existe: true };
      }
    })
  );

  return json({ status: 'ok', resultados }, 200, headers);
}

// Mostra na grade o que já está na agenda real da técnica (Beauty Fair,
// Folga, treinamento lançado manualmente etc) — só leitura, não vira doc em
// `escalas`. Sempre reflete a agenda de verdade, sem risco de duplicar
// nada nem de "item importado" ficar desatualizado depois de editado só no
// Google.
async function handleEscalaEventosTecnica(request, env, headers) {
  const body = await request.json();
  const { tecnicaId, dataInicio, dataFim } = body;
  if (!tecnicaId || !dataInicio || !dataFim) {
    return json({ status: 'error', message: 'campos obrigatórios ausentes' }, 400, headers);
  }

  const { accessToken, erro } = await acessoTecnicaOuErro(env, tecnicaId, headers);
  if (erro) return erro;

  const timeMin = new Date(`${dataInicio}T00:00:00-03:00`).toISOString();
  const timeMax = new Date(new Date(`${dataFim}T00:00:00-03:00`).getTime() + DIA_MS).toISOString();

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) {
    return json({ status: 'error', message: `Falha ao listar eventos: ${await resp.text()}` }, 502, headers);
  }

  const eventos = ((await resp.json()).items || [])
    .filter((e) => !TIPOS_EVENTO_IGNORADOS.has(e.eventType) && e.status !== 'cancelled')
    .map((e) => ({ id: e.id, summary: e.summary || 'Sem título', location: e.location || null, start: e.start, end: e.end }));

  return json({ status: 'ok', eventos }, 200, headers);
}

const DIA_MS = 24 * 60 * 60 * 1000;

function offsetBrasilia(dataHora, campoHora) {
  return new Date(`${dataHora.data}T${dataHora[campoHora]}:00-03:00`).getTime();
}

function meiaNoiteBrasiliaMs(dataISO) {
  return new Date(`${dataISO}T00:00:00-03:00`).getTime();
}

function offsetHoraMs(horaStr) {
  const [h, m] = horaStr.split(':').map(Number);
  return (h * 60 + m) * 60 * 1000;
}

// tipoReserva === 'periodo': {dataInicio, dataFim, horaInicio, horaTermino}
// vira uma OU MAIS janelas de ocupação — 1º dia (do horário de início até o
// fim do dia), dias intermediários (dia inteiro, presume-se ocupado o dia
// todo), último dia (da meia-noite até o horário de término). Se
// dataInicio === dataFim, é só o intervalo do dia mesmo (igual ao "único").
function expandirJanelasPeriodo(opcao) {
  const inicioDiaMs = meiaNoiteBrasiliaMs(opcao.dataInicio);
  const fimDiaMs = meiaNoiteBrasiliaMs(opcao.dataFim);
  const offsetInicioMs = offsetHoraMs(opcao.horaInicio);
  const offsetFimMs = offsetHoraMs(opcao.horaTermino);

  if (inicioDiaMs === fimDiaMs) {
    return [{ inicioMs: inicioDiaMs + offsetInicioMs, fimMs: fimDiaMs + offsetFimMs }];
  }

  const janelas = [{ inicioMs: inicioDiaMs + offsetInicioMs, fimMs: inicioDiaMs + DIA_MS }];
  for (let diaMs = inicioDiaMs + DIA_MS; diaMs < fimDiaMs; diaMs += DIA_MS) {
    janelas.push({ inicioMs: diaMs, fimMs: diaMs + DIA_MS });
  }
  janelas.push({ inicioMs: fimDiaMs, fimMs: fimDiaMs + offsetFimMs });
  return janelas;
}

// Opção pode vir vazia agora (mínimo de opções preenchidas relaxado no
// frontend — só 2 de 4 no único, 1 de 2 no período). Opção vazia = sem
// janela pra checar (nunca conflita), em vez de quebrar em Math.min/Date
// inválida.
function opcaoVazia(opcao, tipoReserva) {
  if (tipoReserva === 'periodo') {
    return !opcao || !opcao.dataInicio || !opcao.dataFim || !opcao.horaInicio || !opcao.horaTermino;
  }
  return !opcao || !opcao.data || !opcao.horaInicio || !opcao.horaTermino;
}

function janelasDaOpcao(opcao, tipoReserva) {
  if (opcaoVazia(opcao, tipoReserva)) return [];
  if (tipoReserva === 'periodo') return expandirJanelasPeriodo(opcao);
  return [{ inicioMs: offsetBrasilia(opcao, 'horaInicio'), fimMs: offsetBrasilia(opcao, 'horaTermino') }];
}

// Regra "domingo trabalhado, segunda de folga": dia da semana da data ISO,
// independente de fuso — é uma propriedade da data civil em si, não do
// instante, então dá pra calcular direto em UTC sem risco de virar de dia.
// 0 = domingo, 1 = segunda, ..., 6 = sábado.
function diaDaSemana(dataISO) {
  return new Date(`${dataISO}T00:00:00Z`).getUTCDay();
}

function diaAnteriorISO(dataISO) {
  return somarDiasISO(dataISO, -1);
}

function somarDiasISO(dataISO, dias) {
  const d = new Date(`${dataISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function hojeISOBrasilia() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// Todos os dias civis cobertos por uma opção — só a data (único) ou cada dia
// entre dataInicio e dataFim, inclusive (período). Comparação de string ISO
// funciona pra ordenar/iterar datas YYYY-MM-DD.
function diasDaOpcao(opcao, tipoReserva) {
  if (opcaoVazia(opcao, tipoReserva)) return [];
  if (tipoReserva !== 'periodo') return [opcao.data];

  const dias = [];
  let atual = opcao.dataInicio;
  while (atual <= opcao.dataFim) {
    dias.push(atual);
    atual = new Date(new Date(`${atual}T00:00:00Z`).getTime() + DIA_MS).toISOString().slice(0, 10);
  }
  return dias;
}

// Domingo ocupado (qualquer coisa na agenda dela) = segunda inteira
// indisponível — regra de descanso, independente de que compromisso é.
// Retorna as datas ISO de domingo (uma por segunda-feira que a opção
// cobre) que precisam ser checadas.
function domingosAntesDeSegunda(opcao, tipoReserva) {
  return diasDaOpcao(opcao, tipoReserva)
    .filter((dia) => diaDaSemana(dia) === 1)
    .map(diaAnteriorISO);
}

// Janela absoluta (ms) de um evento real do Calendar, dia inteiro (start.date)
// ou com hora (start.dateTime) — usado tanto pro conflito por horário quanto
// pela regra do domingo, então só existe um jeito de calcular overlap.
function janelaDoEvento(evento) {
  if (evento.start?.date) {
    return { inicioMs: meiaNoiteBrasiliaMs(evento.start.date), fimMs: meiaNoiteBrasiliaMs(evento.end?.date || evento.start.date) };
  }
  if (evento.start?.dateTime && evento.end?.dateTime) {
    return { inicioMs: new Date(evento.start.dateTime).getTime(), fimMs: new Date(evento.end.dateTime).getTime() };
  }
  return null;
}

function eventoSobrepoe(evento, inicioMs, fimMs) {
  const janela = janelaDoEvento(evento);
  return Boolean(janela) && janela.inicioMs < fimMs && janela.fimMs > inicioMs;
}

function eventoTocaDia(evento, diaISO) {
  const inicioMs = meiaNoiteBrasiliaMs(diaISO);
  return eventoSobrepoe(evento, inicioMs, inicioMs + DIA_MS);
}

// tipoLabel curto só pra identificar o evento "aprovado no sistema" quando o
// conflito vem do Firestore (gap descrito abaixo), não do Calendar.
function nomeAprovadaFirestore(doc) {
  const nome = doc.vendedor || doc.vendedorAcompanha || doc.localInstituicao || doc.nomeRevenda || '—';
  return `Treinamento já aprovado no sistema — ${nome}`;
}

async function verificarConflitosTecnica(env, tecnica, opcoesData, tipoReserva, solicitacaoIdAtual) {
  const refreshToken = await decryptSecret(tecnica.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
  const { access_token: accessToken } = await refreshAccessToken(env, refreshToken);

  const janelasPorOpcao = opcoesData.map((o) => janelasDaOpcao(o, tipoReserva));
  const domingosPorOpcao = opcoesData.map((o) => domingosAntesDeSegunda(o, tipoReserva));
  const todasJanelas = janelasPorOpcao.flat();
  const todosDomingos = [...new Set(domingosPorOpcao.flat())];
  const janelasDomingoMs = todosDomingos.map((d) => ({ inicioMs: meiaNoiteBrasiliaMs(d), fimMs: meiaNoiteBrasiliaMs(d) + DIA_MS }));
  const todosPontos = [...todasJanelas, ...janelasDomingoMs];

  if (todosPontos.length === 0) {
    return opcoesData.map(() => ({ conflito: false, folga: false, eventoConflitante: null }));
  }

  // events.list (não freeBusy.query) cobrindo o range de tudo que importa
  // numa chamada só — freeBusy IGNORA eventos marcados transparency
  // "transparent", que é o padrão de todo evento "dia inteiro" no Google
  // Calendar. Um "Folga"/feira lançado manualmente como dia inteiro nunca
  // aparecia como ocupado pro freeBusy, mesmo estando visível na agenda —
  // bug real reportado (Beauty Fair, Feira CSBD passando batido). events.list
  // devolve o evento de verdade (com summary/horário), então dá também pra
  // mostrar pra Julia QUAL evento está conflitando, não só que existe conflito.
  const timeMin = new Date(Math.min(...todosPontos.map((j) => j.inicioMs))).toISOString();
  const timeMax = new Date(Math.max(...todosPontos.map((j) => j.fimMs))).toISOString();

  // events.list (Calendar real) e a checagem complementar (Firestore) não
  // dependem uma da outra — rodar em paralelo em vez de sequencial corta uma
  // ida a mais de rede da latência de cada "Salvar"/checagem.
  const [respEventos, aprovadasPorColecao] = await Promise.all([
    fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    ),
    Promise.all(COLECOES_SOLICITACOES.map((c) => listAprovadasPorTecnica(env, c, tecnica.id))).catch((err) => {
      // Complementar (não substitui a checagem real do Calendar): solicitações
      // já aprovadas pra essa técnica no Firestore, cobrindo o gap raro de o
      // evento no Calendar dela não ter sido criado (ex: falha na hora da
      // aprovação — aprovar() já avisa isso pra Julia, mas o status fica
      // 'aprovado' mesmo assim). Se essa parte falhar, segue só com a
      // checagem real — não é motivo pra bloquear a checagem inteira.
      console.error(`verificar-conflitos: checagem complementar no Firestore falhou pra técnica ${tecnica.id}:`, err.message);
      return [];
    })
  ]);

  if (!respEventos.ok) {
    console.error(`verificar-conflitos: events.list falhou pra técnica ${tecnica.id}:`, respEventos.status, await respEventos.text());
    return null;
  }
  // "Local de trabalho: Escritório" (workingLocation) e reunião de equipe
  // (link de Meet) não são compromissos de verdade — não podem bloquear
  // aprovação nenhuma (eventoIgnoravelParaDisponibilidade, topo do arquivo).
  const eventos = ((await respEventos.json()).items || []).filter((e) => !eventoIgnoravelParaDisponibilidade(e));
  const aprovadasFirestore = aprovadasPorColecao.flat().filter((doc) => doc.id !== solicitacaoIdAtual && doc.dataEscolhida);

  function eventoConflitanteEm(inicioMs, fimMs) {
    const evReal = eventos.find((e) => eventoSobrepoe(e, inicioMs, fimMs));
    if (evReal) {
      const janela = janelaDoEvento(evReal);
      // id do evento real do Google — usado pelo painel de Escala pra filtrar
      // "conflito consigo mesmo" ao reeditar um item que já tem evento criado
      // naquela mesma janela de horário.
      return { id: evReal.id, summary: evReal.summary || 'Evento sem título', start: evReal.start, end: evReal.end, ...janela };
    }
    const aprovada = aprovadasFirestore.find((doc) =>
      janelasDaOpcao(doc.dataEscolhida, doc.tipoReserva || 'unico').some(
        (j) => j.inicioMs < fimMs && j.fimMs > inicioMs
      )
    );
    if (aprovada) return { summary: nomeAprovadaFirestore(aprovada), start: null, end: null };
    return null;
  }

  // Dois motivos distintos, não misturar: "conflito" é ela já ter algo
  // marcado por HORÁRIO exatamente ali; "folga" é a regra de descanso
  // (trabalhou domingo, indisponível a segunda inteira) — o painel mostra
  // cada um com aviso diferente pra não confundir Julia.
  return opcoesData.map((_, idx) => {
    const conflitoEvento = janelasPorOpcao[idx].reduce((achado, j) => achado || eventoConflitanteEm(j.inicioMs, j.fimMs), null);
    const folgaEvento = domingosPorOpcao[idx].reduce(
      (achado, dia) => achado || eventos.find((e) => eventoTocaDia(e, dia)),
      null
    );
    return {
      conflito: Boolean(conflitoEvento),
      folga: Boolean(folgaEvento),
      eventoConflitante:
        conflitoEvento ||
        (folgaEvento ? { id: folgaEvento.id, summary: folgaEvento.summary || 'Evento sem título', start: folgaEvento.start, end: folgaEvento.end } : null)
    };
  });
}

async function handleVerificarConflitos(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'body inválido' }, 400, headers);
  }

  const { tecnicaIds, opcoesData, tipoReserva, solicitacaoId } = body;
  if (!Array.isArray(tecnicaIds) || !Array.isArray(opcoesData) || opcoesData.length === 0) {
    return json({ status: 'error', message: 'tecnicaIds e opcoesData são obrigatórios' }, 400, headers);
  }

  const entradas = await Promise.all(
    tecnicaIds.map(async (tecnicaId) => {
      try {
        const tecnica = await getTecnica(env, tecnicaId);
        if (!tecnica || !tecnica.refreshTokenEncrypted) return [tecnicaId, null];
        return [tecnicaId, await verificarConflitosTecnica(env, tecnica, opcoesData, tipoReserva || 'unico', solicitacaoId || null)];
      } catch (err) {
        console.error(`verificar-conflitos: falha pra técnica ${tecnicaId}:`, err.message);
        return [tecnicaId, null];
      }
    })
  );

  const conflitos = Object.fromEntries(entradas.filter(([, v]) => v !== null));
  return json({ status: 'ok', conflitos }, 200, headers);
}

const HORA_COMERCIAL_INICIO = 8;
const HORA_COMERCIAL_FIM = 18;

// Um dia é "ocupado" pra uma técnica se ela tem evento real (já filtrado por
// eventoIgnoravelParaDisponibilidade) sobrepondo o horário comercial
// (08h-18h Brasília), ou se ela trabalhou no domingo anterior (mesma regra
// de folga pós-domingo já aplicada na aprovação — domingosAntesDeSegunda).
function tecnicaOcupadaNoDia(eventos, diaISO) {
  const inicioComercialMs = meiaNoiteBrasiliaMs(diaISO) + HORA_COMERCIAL_INICIO * 60 * 60 * 1000;
  const fimComercialMs = meiaNoiteBrasiliaMs(diaISO) + HORA_COMERCIAL_FIM * 60 * 60 * 1000;
  if (eventos.some((e) => eventoSobrepoe(e, inicioComercialMs, fimComercialMs))) return true;

  if (diaDaSemana(diaISO) === 1) {
    const domingo = diaAnteriorISO(diaISO);
    if (eventos.some((e) => eventoTocaDia(e, domingo))) return true;
  }
  return false;
}

// Sugere dias (não horários — só o dia) em que PELO MENOS UMA das técnicas
// da lista está livre de verdade. Quem chama decide a lista: só a Vithoria
// (Rio Claro, prioridade dela) ou todas as ativas (demais casos) — esta rota
// não sabe nem precisa saber o que é "Rio Claro".
async function handleSugerirDatas(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'body inválido' }, 400, headers);
  }

  const tecnicaIds = Array.isArray(body?.tecnicaIds) ? body.tecnicaIds : [];
  const diasMinimos = body.diasMinimos || 7;
  const quantidade = body.quantidade || 4;
  if (tecnicaIds.length === 0) {
    return json({ status: 'error', message: 'tecnicaIds é obrigatório' }, 400, headers);
  }

  const JANELA_MAX_DIAS = 90;
  const primeiroDia = somarDiasISO(hojeISOBrasilia(), diasMinimos);
  const ultimoDia = somarDiasISO(primeiroDia, JANELA_MAX_DIAS);
  const timeMin = new Date(meiaNoiteBrasiliaMs(primeiroDia)).toISOString();
  const timeMax = new Date(meiaNoiteBrasiliaMs(ultimoDia) + DIA_MS).toISOString();

  // Uma chamada events.list por técnica cobrindo a janela toda — mesmo
  // padrão de verificarConflitosTecnica/handleEscalaEventosTecnica. Técnica
  // não conectada ou com falha vira `null` (não entra na conta de "livre" —
  // sem dado real, não dá pra afirmar disponibilidade, bem diferente de
  // "zero eventos = sempre livre").
  const eventosPorTecnica = await Promise.all(
    tecnicaIds.map(async (tecnicaId) => {
      try {
        const tecnica = await getTecnica(env, tecnicaId);
        if (!tecnica?.refreshTokenEncrypted) return null;
        const refreshToken = await decryptSecret(tecnica.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
        const { access_token: accessToken } = await refreshAccessToken(env, refreshToken);
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!resp.ok) return null;
        return ((await resp.json()).items || []).filter((e) => !eventoIgnoravelParaDisponibilidade(e));
      } catch (err) {
        console.error(`sugerir-datas: falha ao buscar agenda da técnica ${tecnicaId}:`, err.message);
        return null;
      }
    })
  );

  const datas = [];
  for (let diaISO = primeiroDia; diaISO <= ultimoDia && datas.length < quantidade; diaISO = somarDiasISO(diaISO, 1)) {
    const algumaLivre = eventosPorTecnica.some((eventos) => eventos !== null && !tecnicaOcupadaNoDia(eventos, diaISO));
    if (algumaLivre) datas.push(diaISO);
  }

  return json({ status: 'ok', datas }, 200, headers);
}

export default {
  async fetch(request, env) {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const url = new URL(request.url);
    const headers = corsHeaders(request);

    if (url.pathname === '/health') {
      return json({ status: 'ok', worker: 'smartgr-agenda-tecnicas-calendar' }, 200, headers);
    }

    if (url.pathname === '/oauth/iniciar' && request.method === 'GET') {
      return handleOauthIniciar(url, env, headers);
    }

    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      return handleOauthCallback(url, env, headers);
    }

    if (url.pathname === '/criar-evento' && request.method === 'POST') {
      try {
        return await handleCriarEvento(request, env, headers);
      } catch (err) {
        console.error('criar-evento: exceção não tratada:', err.stack || err.message || err);
        return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
      }
    }

    if (url.pathname === '/verificar-conflitos' && request.method === 'POST') {
      try {
        return await handleVerificarConflitos(request, env, headers);
      } catch (err) {
        console.error('verificar-conflitos: exceção não tratada:', err.stack || err.message || err);
        return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
      }
    }

    if (url.pathname === '/escala/criar-evento' && request.method === 'POST') {
      try {
        return await handleEscalaCriarEvento(request, env, headers);
      } catch (err) {
        console.error('escala/criar-evento: exceção não tratada:', err.stack || err.message || err);
        return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
      }
    }

    if (url.pathname === '/escala/atualizar-evento' && request.method === 'POST') {
      try {
        return await handleEscalaAtualizarEvento(request, env, headers);
      } catch (err) {
        console.error('escala/atualizar-evento: exceção não tratada:', err.stack || err.message || err);
        return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
      }
    }

    if (url.pathname === '/escala/excluir-evento' && request.method === 'POST') {
      try {
        return await handleEscalaExcluirEvento(request, env, headers);
      } catch (err) {
        console.error('escala/excluir-evento: exceção não tratada:', err.stack || err.message || err);
        return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
      }
    }

    if (url.pathname === '/escala/verificar-eventos' && request.method === 'POST') {
      try {
        return await handleEscalaVerificarEventos(request, env, headers);
      } catch (err) {
        console.error('escala/verificar-eventos: exceção não tratada:', err.stack || err.message || err);
        return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
      }
    }

    if (url.pathname === '/escala/eventos-tecnica' && request.method === 'POST') {
      try {
        return await handleEscalaEventosTecnica(request, env, headers);
      } catch (err) {
        console.error('escala/eventos-tecnica: exceção não tratada:', err.stack || err.message || err);
        return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
      }
    }

    if (url.pathname === '/sugerir-datas' && request.method === 'POST') {
      try {
        return await handleSugerirDatas(request, env, headers);
      } catch (err) {
        console.error('sugerir-datas: exceção não tratada:', err.stack || err.message || err);
        return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
      }
    }

    return json({ status: 'not_implemented', message: 'Rota não encontrada.' }, 501, headers);
  }
};

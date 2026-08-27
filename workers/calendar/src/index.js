/**
 * Fase 2: OAuth do Google Calendar (escopo calendar.events) por técnica
 * e criação automática de evento na agenda individual ao aprovar solicitação.
 */
import { buildGoogleAuthUrl, exchangeCodeForTokens, refreshAccessToken, getGoogleUserInfo } from './googleAuth.js';
import { findTecnicaByEmail, getTecnica, patchTecnica } from './firestoreRest.js';
import { encryptSecret, decryptSecret, signState, verifyState } from './crypto.js';
import { corsHeaders, handlePreflight } from './cors.js';

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

const TIPO_LABEL = {
  consumidor_final: 'Consumidor Final',
  revenda: 'Revendas/Redes',
  workshop: 'Workshop'
};

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

  if (tipo === 'revenda') {
    return [
      s.nomeRevenda ? `Revenda/Rede: ${s.nomeRevenda}` : null,
      s.tema ? `Tema: ${s.tema}` : null,
      s.destinoTreinamento ? `Destino: ${s.destinoTreinamento === 'propria_revenda' ? 'Equipe própria' : 'Cliente da revenda'}` : null
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

async function handleCriarEvento(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'body inválido' }, 400, headers);
  }

  const { tecnicaId, tipo, tipoTreinamento, tipoReserva, modalidade, endereco, nomeSolicitante, dataHora, solicitacao } = body;
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

  const tipoLabel = TIPO_LABEL[tipo] || tipo;
  const location = modalidade === 'online' ? 'Online' : formatEndereco(endereco) || 'A confirmar';

  const eventBody = {
    summary: `Treinamento ${tipoLabel} — ${nomeSolicitante}`,
    description: [
      `Tipo: ${tipoLabel}`,
      tipoTreinamento ? `Treinamento: ${tipoTreinamento === 'interno' ? 'Interno' : 'Externo'}` : null,
      `Solicitante: ${nomeSolicitante}`,
      ...formatarDescricaoSolicitacao(tipo, solicitacao)
    ]
      .filter(Boolean)
      .join('\n'),
    location,
    start: ehPeriodo
      ? { dateTime: `${dataHora.dataInicio}T${dataHora.horaInicio}:00`, timeZone: 'America/Sao_Paulo' }
      : { dateTime: `${dataHora.data}T${dataHora.horaInicio}:00`, timeZone: 'America/Sao_Paulo' },
    end: ehPeriodo
      ? { dateTime: `${dataHora.dataFim}T${dataHora.horaTermino}:00`, timeZone: 'America/Sao_Paulo' }
      : { dateTime: `${dataHora.data}T${dataHora.horaTermino}:00`, timeZone: 'America/Sao_Paulo' }
  };

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

// Uma chamada freeBusy por técnica cobrindo o intervalo [menor início, maior
// término] entre todas as janelas de todas as opções — mais barato que uma
// chamada por combinação técnica×opção×dia. Overlap é checado localmente
// depois, opção por opção (conflito = QUALQUER janela daquela opção bate
// com algum bloco ocupado real da técnica).
async function verificarConflitosTecnica(env, tecnica, opcoesData, tipoReserva) {
  const refreshToken = await decryptSecret(tecnica.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
  const { access_token: accessToken } = await refreshAccessToken(env, refreshToken);

  const janelasPorOpcao = opcoesData.map((o) => janelasDaOpcao(o, tipoReserva));
  const todasJanelas = janelasPorOpcao.flat();
  if (todasJanelas.length === 0) return opcoesData.map(() => false);
  const timeMin = new Date(Math.min(...todasJanelas.map((j) => j.inicioMs))).toISOString();
  const timeMax = new Date(Math.max(...todasJanelas.map((j) => j.fimMs))).toISOString();

  const resp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] })
  });

  if (!resp.ok) {
    console.error(`verificar-conflitos: freeBusy falhou pra técnica ${tecnica.id}:`, resp.status, await resp.text());
    return null;
  }

  const data = await resp.json();
  const ocupado = data.calendars?.primary?.busy || [];

  return janelasPorOpcao.map((janelas) =>
    janelas.some((j) =>
      ocupado.some((b) => {
        const bInicio = new Date(b.start).getTime();
        const bFim = new Date(b.end).getTime();
        return j.inicioMs < bFim && j.fimMs > bInicio;
      })
    )
  );
}

async function handleVerificarConflitos(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'body inválido' }, 400, headers);
  }

  const { tecnicaIds, opcoesData, tipoReserva } = body;
  if (!Array.isArray(tecnicaIds) || !Array.isArray(opcoesData) || opcoesData.length === 0) {
    return json({ status: 'error', message: 'tecnicaIds e opcoesData são obrigatórios' }, 400, headers);
  }

  const entradas = await Promise.all(
    tecnicaIds.map(async (tecnicaId) => {
      try {
        const tecnica = await getTecnica(env, tecnicaId);
        if (!tecnica || !tecnica.refreshTokenEncrypted) return [tecnicaId, null];
        return [tecnicaId, await verificarConflitosTecnica(env, tecnica, opcoesData, tipoReserva || 'unico')];
      } catch (err) {
        console.error(`verificar-conflitos: falha pra técnica ${tecnicaId}:`, err.message);
        return [tecnicaId, null];
      }
    })
  );

  const conflitos = Object.fromEntries(entradas.filter(([, v]) => v !== null));
  return json({ status: 'ok', conflitos }, 200, headers);
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

    return json({ status: 'not_implemented', message: 'Rota não encontrada.' }, 501, headers);
  }
};

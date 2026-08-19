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
  revenda: 'Revenda',
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

  const { tecnicaId, tipo, tipoTreinamento, modalidade, endereco, nomeSolicitante, dataHora } = body;
  if (!tecnicaId || !tipo || !nomeSolicitante || !dataHora?.data || !dataHora?.horaInicio || !dataHora?.horaTermino) {
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
      `Solicitante: ${nomeSolicitante}`
    ]
      .filter(Boolean)
      .join('\n'),
    location,
    start: { dateTime: `${dataHora.data}T${dataHora.horaInicio}:00`, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: `${dataHora.data}T${dataHora.horaTermino}:00`, timeZone: 'America/Sao_Paulo' }
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

function offsetBrasilia(dataHora, campoHora) {
  return new Date(`${dataHora.data}T${dataHora[campoHora]}:00-03:00`).getTime();
}

// Uma chamada freeBusy por técnica cobrindo o intervalo [menor início, maior
// término] entre todas as opções de data — mais barato que uma chamada por
// combinação técnica×data. Overlap é checado localmente depois.
async function verificarConflitosTecnica(env, tecnica, opcoesData) {
  const refreshToken = await decryptSecret(tecnica.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
  const { access_token: accessToken } = await refreshAccessToken(env, refreshToken);

  const inicios = opcoesData.map((o) => offsetBrasilia(o, 'horaInicio'));
  const fins = opcoesData.map((o) => offsetBrasilia(o, 'horaTermino'));
  const timeMin = new Date(Math.min(...inicios)).toISOString();
  const timeMax = new Date(Math.max(...fins)).toISOString();

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

  return opcoesData.map((o) => {
    const inicioMs = offsetBrasilia(o, 'horaInicio');
    const fimMs = offsetBrasilia(o, 'horaTermino');
    return ocupado.some((b) => {
      const bInicio = new Date(b.start).getTime();
      const bFim = new Date(b.end).getTime();
      return inicioMs < bFim && fimMs > bInicio;
    });
  });
}

async function handleVerificarConflitos(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'body inválido' }, 400, headers);
  }

  const { tecnicaIds, opcoesData } = body;
  if (!Array.isArray(tecnicaIds) || !Array.isArray(opcoesData) || opcoesData.length === 0) {
    return json({ status: 'error', message: 'tecnicaIds e opcoesData são obrigatórios' }, 400, headers);
  }

  const entradas = await Promise.all(
    tecnicaIds.map(async (tecnicaId) => {
      try {
        const tecnica = await getTecnica(env, tecnicaId);
        if (!tecnica || !tecnica.refreshTokenEncrypted) return [tecnicaId, null];
        return [tecnicaId, await verificarConflitosTecnica(env, tecnica, opcoesData)];
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

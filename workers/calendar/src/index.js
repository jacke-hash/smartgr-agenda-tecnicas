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
    const tokens = await exchangeCodeForTokens(env, code);
    if (!tokens.refresh_token) {
      return redirectParaFrontend(state.origin, 'erro', 'sem_refresh_token');
    }

    const userInfo = await getGoogleUserInfo(tokens.access_token);
    if (!userInfo.email || !userInfo.email_verified || !userInfo.email.endsWith('@smartgr.com.br')) {
      return redirectParaFrontend(state.origin, 'erro', 'conta_invalida');
    }

    const tecnica = await findTecnicaByEmail(env, userInfo.email);
    if (!tecnica) return redirectParaFrontend(state.origin, 'erro', 'tecnica_nao_encontrada');

    const refreshTokenEncrypted = await encryptSecret(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY);
    await patchTecnica(env, tecnica.id, { refreshTokenEncrypted, conectadoEm: new Date() });

    return redirectParaFrontend(state.origin, 'sucesso');
  } catch (err) {
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

    return json({ status: 'not_implemented', message: 'Rota não encontrada.' }, 501, headers);
  }
};

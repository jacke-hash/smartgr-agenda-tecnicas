/**
 * Fase 2: OAuth do Google Calendar (escopo calendar.events) por técnica
 * e criação automática de evento na agenda individual ao aprovar solicitação.
 */
import { buildGoogleAuthUrl, exchangeCodeForTokens, refreshAccessToken, getGoogleUserInfo } from './googleAuth.js';
import { findTecnicaByEmail, getTecnica, patchTecnica } from './firestoreRest.js';
import { encryptSecret, decryptSecret, signState, verifyState } from './crypto.js';

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

const TIPO_LABEL = {
  consumidor_final: 'Consumidor Final',
  revenda: 'Revenda',
  workshop: 'Workshop'
};

function json(data, status = 200) {
  return Response.json(data, { status });
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

async function handleOauthIniciar(url, env) {
  const origin = url.searchParams.get('origin');
  if (!origin) return json({ status: 'error', message: 'origin é obrigatório' }, 400);

  const state = await signState({ origin, ts: Date.now() }, env.TOKEN_ENCRYPTION_KEY);
  return Response.redirect(buildGoogleAuthUrl(env, state), 302);
}

async function handleOauthCallback(url, env) {
  const stateToken = url.searchParams.get('state');
  const state = await verifyState(stateToken, env.TOKEN_ENCRYPTION_KEY, STATE_MAX_AGE_MS);
  if (!state) return json({ status: 'error', message: 'state inválido ou expirado' }, 400);

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

async function handleCriarEvento(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'body inválido' }, 400);
  }

  const { tecnicaId, tipo, tipoTreinamento, modalidade, endereco, nomeSolicitante, dataHora } = body;
  if (!tecnicaId || !tipo || !nomeSolicitante || !dataHora?.data || !dataHora?.horaInicio || !dataHora?.horaTermino) {
    return json({ status: 'error', message: 'campos obrigatórios ausentes' }, 400);
  }

  const tecnica = await getTecnica(env, tecnicaId);
  if (!tecnica) return json({ status: 'error', message: 'técnica não encontrada' }, 404);
  if (!tecnica.refreshTokenEncrypted) {
    return json({ status: 'error', message: 'técnica ainda não conectou a agenda' }, 409);
  }

  const refreshToken = await decryptSecret(tecnica.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
  const { access_token: accessToken } = await refreshAccessToken(env, refreshToken);

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
    return json({ status: 'error', message: `Falha ao criar evento: ${await resp.text()}` }, 502);
  }

  const evento = await resp.json();
  return json({ status: 'ok', eventId: evento.id, htmlLink: evento.htmlLink });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', worker: 'smartgr-agenda-tecnicas-calendar' });
    }

    if (url.pathname === '/oauth/iniciar' && request.method === 'GET') {
      return handleOauthIniciar(url, env);
    }

    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      return handleOauthCallback(url, env);
    }

    if (url.pathname === '/criar-evento' && request.method === 'POST') {
      try {
        return await handleCriarEvento(request, env);
      } catch (err) {
        return json({ status: 'error', message: err.message || 'erro interno' }, 500);
      }
    }

    return json({ status: 'not_implemented', message: 'Rota não encontrada.' }, 501);
  }
};

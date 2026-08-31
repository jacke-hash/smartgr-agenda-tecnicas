function base64UrlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importServiceAccountKey(privateKeyPem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function getServiceAccountAccessToken(serviceAccount, scope) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope,
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600
  };
  const signingInput = `${base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)))}.${base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(claims))
  )}`;
  const key = await importServiceAccountKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!resp.ok) {
    throw new Error(`Falha ao obter access token da service account: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.access_token;
}

export function buildGoogleAuthUrl(env, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy email',
    access_type: 'offline',
    prompt: 'consent',
    hd: 'smartgr.com.br',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(env, code) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  if (!resp.ok) {
    throw new Error(`Falha ao trocar code por tokens: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

async function refreshAccessTokenSemCache(env, refreshToken) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  if (!resp.ok) {
    throw new Error(`Falha ao renovar access token: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

// Uma solicitação típica (verificar-conflitos, depois criar/atualizar-evento
// pra confirmar) troca o refresh token da MESMA técnica pelo access token
// mais de uma vez, em requisições HTTP separadas — sem cache, cada uma delas
// era uma ida inteira ao OAuth do Google, empilhando latência e fazendo o
// "Salvar" parecer travado. Isolate do Worker fica quente entre requisições,
// então cachear em módulo (chave = o próprio refresh token, só em memória,
// nunca persistido) beneficia tanto chamadas paralelas quanto sequenciais.
// Token de usuário do Google também dura ~1h — mesma margem de segurança do
// cache da service account.
const cachePorRefreshToken = new Map();

export async function refreshAccessToken(env, refreshToken) {
  const agora = Date.now();
  const cache = cachePorRefreshToken.get(refreshToken);
  if (cache && agora < cache.expiraEm && !cache.emAndamento) return cache.dados;
  if (cache?.emAndamento) return cache.emAndamento;

  const promessa = refreshAccessTokenSemCache(env, refreshToken)
    .then((dados) => {
      const expiraEmMs = dados.expires_in ? (dados.expires_in - 120) * 1000 : 55 * 60 * 1000;
      cachePorRefreshToken.set(refreshToken, { dados, expiraEm: Date.now() + expiraEmMs, emAndamento: null });
      return dados;
    })
    .catch((err) => {
      // Sem isso, uma falha transitória (rede, token revogado) deixaria essa
      // técnica travada pro resto da vida do isolate — toda chamada futura
      // reaproveitaria a MESMA promise rejeitada em cache.
      cachePorRefreshToken.delete(refreshToken);
      throw err;
    });
  cachePorRefreshToken.set(refreshToken, { dados: null, expiraEm: 0, emAndamento: promessa });
  return promessa;
}

export async function getGoogleUserInfo(accessToken) {
  const resp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!resp.ok) {
    throw new Error(`Falha ao buscar userinfo: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

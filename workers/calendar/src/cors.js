const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/smartgr-agenda-tecnicas\.pages\.dev$/,
  /^https:\/\/[a-z0-9-]+\.smartgr-agenda-tecnicas\.pages\.dev$/, // preview deployments
  /^https:\/\/agendatecnica\.smartgr\.com\.br$/,
  /^https:\/\/www\.agendatecnica\.smartgr\.com\.br$/,
  /^http:\/\/localhost:\d+$/
];

const ORIGEM_PADRAO = 'https://agendatecnica.smartgr.com.br';

export function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const permitido = ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
  return {
    'Access-Control-Allow-Origin': permitido ? origin : ORIGEM_PADRAO,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

export function handlePreflight(request) {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

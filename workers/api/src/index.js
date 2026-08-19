import { corsHeaders, handlePreflight } from './cors.js';

export default {
  async fetch(request) {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const url = new URL(request.url);
    const headers = corsHeaders(request);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', worker: 'smartgr-agenda-tecnicas-api' }, { headers });
    }

    return Response.json(
      { status: 'not_implemented', message: 'Endpoints da API ficam para a Fase 2.' },
      { status: 501, headers }
    );
  }
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', worker: 'smartgr-agenda-tecnicas-api' });
    }

    return Response.json(
      { status: 'not_implemented', message: 'Endpoints da API ficam para a Fase 2.' },
      { status: 501 }
    );
  }
};

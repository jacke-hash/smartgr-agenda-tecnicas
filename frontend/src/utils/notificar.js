export async function notificarNovaSolicitacao(tipo, resumo) {
  const workerUrl = import.meta.env.VITE_EMAIL_WORKER_URL;
  if (!workerUrl) return;

  try {
    await fetch(`${workerUrl}/notificar-nova-solicitacao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo,
        resumo,
        painelUrl: `${window.location.origin}/#/painel`
      })
    });
  } catch (err) {
    console.error('Falha ao notificar Julia por e-mail:', err);
  }
}

export async function notificarAprovacao(payload) {
  const workerUrl = import.meta.env.VITE_EMAIL_WORKER_URL;
  if (!workerUrl) return;

  try {
    await fetch(`${workerUrl}/notificar-aprovacao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Falha ao notificar aprovação por e-mail:', err);
  }
}

const ROTA_FORM_POR_TIPO = {
  consumidor_final: '#/consumidor-final',
  revenda: '#/revenda',
  workshop: '#/workshop'
};

export async function notificarRecusa({ vendedorEmail, vendedorNome, tipo }) {
  const workerUrl = import.meta.env.VITE_EMAIL_WORKER_URL;
  if (!workerUrl) return;

  try {
    await fetch(`${workerUrl}/notificar-recusa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendedorEmail,
        vendedorNome,
        tipo,
        formUrl: `${window.location.origin}/${ROTA_FORM_POR_TIPO[tipo] || ''}`
      })
    });
  } catch (err) {
    console.error('Falha ao notificar recusa por e-mail:', err);
  }
}

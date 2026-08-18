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

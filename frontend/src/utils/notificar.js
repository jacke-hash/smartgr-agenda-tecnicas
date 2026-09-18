export async function notificarNovaSolicitacao(tipo, resumo, { copiaThayla = false } = {}) {
  const workerUrl = import.meta.env.VITE_EMAIL_WORKER_URL;
  if (!workerUrl) return;

  try {
    await fetch(`${workerUrl}/notificar-nova-solicitacao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo,
        resumo,
        copiaThayla,
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

// Técnica recusando um treinamento já aprovado por cair fora do expediente
// (fim de semana/feriado/fora 08:30–17:30) — avisa a Julia por e-mail, ela
// reatribui pela aba "Aprovadas" do painel dela (mesmo fluxo de "Trocar
// técnica" que já existe hoje).
export async function notificarRecusaTecnica({ tecnicaNome, tipo, tipoReserva, dataHora, motivo, vendedorNome }) {
  const workerUrl = import.meta.env.VITE_EMAIL_WORKER_URL;
  if (!workerUrl) return;

  try {
    await fetch(`${workerUrl}/notificar-recusa-tecnica`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tecnicaNome,
        tipo,
        tipoReserva,
        dataHora,
        motivo,
        vendedorNome,
        painelUrl: `${window.location.origin}/#/painel`
      })
    });
  } catch (err) {
    console.error('Falha ao notificar recusa da técnica por e-mail:', err);
  }
}

// 2ª técnica adicionada a um treinamento JÁ aprovado (aba "Aprovadas" do
// painel — salvarSegundaTecnica em painel-julia.js). Só ela recebe e-mail
// aqui; o vendedor e a 1ª técnica já foram notificados na aprovação original.
export async function notificarTecnicaAdicionada(payload) {
  const workerUrl = import.meta.env.VITE_EMAIL_WORKER_URL;
  if (!workerUrl) return;

  try {
    await fetch(`${workerUrl}/notificar-tecnica-adicionada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Falha ao notificar 2ª técnica adicionada por e-mail:', err);
  }
}

export async function notificarRecusa({ vendedorEmail, vendedorNome, tipo, motivoRecusa }) {
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
        motivoRecusa,
        formUrl: `${window.location.origin}/${ROTA_FORM_POR_TIPO[tipo] || ''}`
      })
    });
  } catch (err) {
    console.error('Falha ao notificar recusa por e-mail:', err);
  }
}

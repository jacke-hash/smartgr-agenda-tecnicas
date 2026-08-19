/**
 * Fase 2: envio de e-mails transacionais via Resend.
 * Todo o conteúdo do e-mail vem no body da requisição — este worker não
 * acessa Firestore, só formata e dispara via Resend.
 */
import { corsHeaders, handlePreflight } from './cors.js';

const TIPO_LABEL = {
  consumidor_final: 'Consumidor Final',
  revenda: 'Revenda',
  workshop: 'Workshop'
};

function json(data, status, headers) {
  return Response.json(data, { status: status || 200, headers });
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

async function enviarEmail(env, { to, subject, html }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Agenda de Treinamento SmartGR <agenda@smartgr.com.br>',
      to,
      subject,
      html
    })
  });

  if (!resp.ok) {
    throw new Error(`Falha ao enviar e-mail via Resend: ${resp.status} ${await resp.text()}`);
  }
}

async function handleNotificarNovaSolicitacao(request, env, headers) {
  const body = await request.json();
  const { tipo, resumo, painelUrl } = body;
  if (!tipo || !resumo) return json({ status: 'error', message: 'tipo e resumo são obrigatórios' }, 400, headers);

  const tipoLabel = TIPO_LABEL[tipo] || tipo;
  const linhas = Object.entries(resumo)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`)
    .join('');

  await enviarEmail(env, {
    to: 'julia@smartgr.com.br',
    subject: `Nova solicitação de treinamento aguardando aprovação — ${tipoLabel}`,
    html: `
      <p>Uma nova solicitação de treinamento (${tipoLabel}) foi registrada e aguarda sua aprovação.</p>
      <ul>${linhas}</ul>
      ${painelUrl ? `<p><a href="${painelUrl}">Abrir painel de aprovação</a></p>` : ''}
    `
  });

  return json({ status: 'ok' }, 200, headers);
}

async function handleNotificarAprovacao(request, env, headers) {
  const body = await request.json();
  const { vendedorEmail, vendedorNome, tipo, tipoTreinamento, modalidade, tecnicaNome, dataHora, endereco } = body;

  if (!vendedorEmail || !tipo || !tecnicaNome || !dataHora) {
    return json(
      { status: 'error', message: 'vendedorEmail, tipo, tecnicaNome e dataHora são obrigatórios' },
      400,
      headers
    );
  }

  const tipoLabel = TIPO_LABEL[tipo] || tipo;
  const local = modalidade === 'online' ? 'Online' : formatEndereco(endereco) || 'A confirmar';

  await enviarEmail(env, {
    to: vendedorEmail,
    subject: `Treinamento aprovado — ${tipoLabel}`,
    html: `
      <p>Olá${vendedorNome ? ` ${vendedorNome}` : ''},</p>
      <p>Seu treinamento (${tipoLabel}) foi aprovado.</p>
      <ul>
        <li><strong>Técnica responsável:</strong> ${tecnicaNome}</li>
        <li><strong>Data:</strong> ${dataHora.data} · ${dataHora.horaInicio} às ${dataHora.horaTermino}</li>
        <li><strong>Local:</strong> ${local}</li>
      </ul>
    `
  });

  if (tipo === 'consumidor_final' && tipoTreinamento === 'interno' && modalidade === 'presencial') {
    await enviarEmail(env, {
      to: env.NAYRA_EMAIL,
      subject: 'Treinamento interno presencial confirmado — café/atendimento',
      html: `
        <p>Um treinamento interno presencial (Consumidor Final) foi aprovado.</p>
        <ul>
          <li><strong>Solicitante:</strong> ${vendedorNome || '—'}</li>
          <li><strong>Técnica responsável:</strong> ${tecnicaNome}</li>
          <li><strong>Data:</strong> ${dataHora.data} · ${dataHora.horaInicio} às ${dataHora.horaTermino}</li>
        </ul>
        <p>Favor providenciar café/atendimento para o dia.</p>
      `
    });
  }

  return json({ status: 'ok' }, 200, headers);
}

export default {
  async fetch(request, env) {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const url = new URL(request.url);
    const headers = corsHeaders(request);

    if (url.pathname === '/health') {
      return json({ status: 'ok', worker: 'smartgr-agenda-tecnicas-email' }, 200, headers);
    }

    try {
      if (url.pathname === '/notificar-nova-solicitacao' && request.method === 'POST') {
        return await handleNotificarNovaSolicitacao(request, env, headers);
      }
      if (url.pathname === '/notificar-aprovacao' && request.method === 'POST') {
        return await handleNotificarAprovacao(request, env, headers);
      }
    } catch (err) {
      return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
    }

    return json({ status: 'not_implemented', message: 'Rota não encontrada.' }, 501, headers);
  }
};

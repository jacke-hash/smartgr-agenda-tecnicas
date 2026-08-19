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

// Só pra exibição no corpo do e-mail — o valor que chega aqui (dataHora.data)
// continua ISO (YYYY-MM-DD), sem impacto em nada além do texto mostrado.
function formatarDataBR(dataISO) {
  if (!dataISO) return dataISO;
  const [ano, mes, dia] = dataISO.split('-');
  if (!ano || !mes || !dia) return dataISO;
  return `${dia}-${mes}-${ano}`;
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

// Espelha (em HTML de e-mail) os campos que o painel da Julia já mostra por
// tipo (frontend/src/pages/painel-julia.js, renderInfoConsumidorFinal/
// Revenda/Workshop) — duplicação consciente, contexto de renderização
// diferente (worker/e-mail vs DOM do browser).
function formatarCamposSolicitacao(tipo, s) {
  if (!s) return '';

  if (tipo === 'consumidor_final') {
    return `
      <li><strong>Vendedor:</strong> ${s.vendedor || '—'}</li>
      <li><strong>Contato:</strong> ${s.contato || '—'}</li>
      <li><strong>Perfil do profissional:</strong> ${s.perfilProfissional || '—'}</li>
      <li><strong>Equipamento:</strong> ${s.equipamentoComprado || '—'}</li>
      ${s.numeroSerie ? `<li><strong>Número de série:</strong> ${s.numeroSerie}</li>` : ''}
      ${s.insumosAdquiridos ? `<li><strong>Insumos:</strong> ${s.insumosAdquiridos}</li>` : ''}
      <li><strong>Tipo de treinamento:</strong> ${s.tipoTreinamento === 'interno' ? 'Interno' : 'Externo'}</li>
      ${s.unidade ? `<li><strong>Unidade:</strong> ${s.unidade}</li>` : ''}
      ${s.observacao ? `<li><strong>Observação:</strong> ${s.observacao}</li>` : ''}
      <li><strong>Participantes:</strong> ${(s.participantes || []).map((p) => `${p.nome} (${p.profissao})`).join(', ') || '—'}</li>
    `;
  }

  if (tipo === 'revenda') {
    return `
      <li><strong>Revenda:</strong> ${s.nomeRevenda || '—'}</li>
      <li><strong>Vendedor:</strong> ${s.vendedor || '—'}</li>
      <li><strong>Destino:</strong> ${s.destinoTreinamento === 'propria_revenda' ? 'Equipe própria' : 'Cliente da revenda'}</li>
      <li><strong>Tema:</strong> ${s.tema || '—'}</li>
      <li><strong>Marcas que trabalha:</strong> ${s.marcasQueTrabalha || '—'}</li>
      <li><strong>Linha completa SmartGR:</strong> ${s.trabalhaLinhaCompletaSmartGR ? 'Sim' : 'Não'}</li>
      <li><strong>Tem técnica própria:</strong> ${s.temTecnicaPropria ? 'Sim' : 'Não'}</li>
      <li><strong>Sala de cursos:</strong> ${s.temSalaCursos ? `Sim (${s.capacidadeSala || '?'} pessoas)` : 'Não'}</li>
      <li><strong>Espaço de prática:</strong> ${s.possuiEspacoPratica ? `Sim (${s.tipoPratica || '—'})` : 'Não'}</li>
      <li><strong>Transporte:</strong> ${s.precisaTransporte ? `${s.transporte?.meio || '—'} — paga: ${s.transporte?.quemPaga || '—'}` : 'Não precisa'}</li>
    `;
  }

  if (tipo === 'workshop') {
    return `
      <li><strong>Instituição:</strong> ${s.localInstituicao || '—'}</li>
      <li><strong>Vendedor:</strong> ${s.vendedorAcompanha || '—'}</li>
      <li><strong>Tema:</strong> ${s.tema || '—'}</li>
      <li><strong>Público:</strong> ${s.publico || '—'}</li>
      <li><strong>Participantes estimados:</strong> ${s.participantesEstimados ?? '—'}</li>
      <li><strong>Demonstração prática:</strong> ${s.teraDemonstracaoPratica ? 'Sim' : 'Não'}</li>
      ${s.qualEquipamento ? `<li><strong>Equipamento:</strong> ${s.qualEquipamento}</li>` : ''}
      ${s.materialApoio ? `<li><strong>Material de apoio:</strong> ${s.materialApoio}</li>` : ''}
      <li><strong>Responsável local:</strong> ${s.responsavelLocal?.nome || '—'} (${s.responsavelLocal?.contato || '—'})</li>
      ${s.observacoes ? `<li><strong>Observações:</strong> ${s.observacoes}</li>` : ''}
    `;
  }

  return '';
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
  const {
    vendedorEmail,
    vendedorNome,
    tipo,
    tipoTreinamento,
    modalidade,
    tecnicaNome,
    tecnicaEmail,
    dataHora,
    endereco,
    solicitacao
  } = body;

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
        <li><strong>Data:</strong> ${formatarDataBR(dataHora.data)} · ${dataHora.horaInicio} às ${dataHora.horaTermino}</li>
        <li><strong>Local:</strong> ${local}</li>
      </ul>
    `
  });

  if (
    tipo === 'consumidor_final' &&
    tipoTreinamento === 'interno' &&
    modalidade === 'presencial' &&
    solicitacao?.unidade === 'Zona Sul'
  ) {
    await enviarEmail(env, {
      to: env.NAYRA_EMAIL,
      subject: 'Treinamento interno presencial confirmado — café/atendimento',
      html: `
        <p>Um treinamento interno presencial (Consumidor Final) foi aprovado.</p>
        <ul>
          <li><strong>Solicitante:</strong> ${vendedorNome || '—'}</li>
          <li><strong>Técnica responsável:</strong> ${tecnicaNome}</li>
          <li><strong>Data:</strong> ${formatarDataBR(dataHora.data)} · ${dataHora.horaInicio} às ${dataHora.horaTermino}</li>
        </ul>
        <p>Favor providenciar café/atendimento para o dia.</p>
      `
    });
  }

  if (tecnicaEmail) {
    const nomeSolicitanteLabel = vendedorNome || tecnicaNome;
    await enviarEmail(env, {
      to: tecnicaEmail,
      subject: `Novo treinamento atribuído a você: ${tipoLabel} — ${solicitacao?.vendedor || solicitacao?.vendedorAcompanha || solicitacao?.localInstituicao || solicitacao?.nomeRevenda || nomeSolicitanteLabel}`,
      html: `
        <p>Olá${tecnicaNome ? ` ${tecnicaNome}` : ''},</p>
        <p>Você foi designada para um novo treinamento (${tipoLabel}). Consulte os dados abaixo e confira sua agenda para se programar.</p>
        <ul>
          ${formatarCamposSolicitacao(tipo, solicitacao)}
          <li><strong>Data:</strong> ${formatarDataBR(dataHora.data)} · ${dataHora.horaInicio} às ${dataHora.horaTermino}</li>
          <li><strong>Local:</strong> ${local}</li>
        </ul>
      `
    });
  }

  return json({ status: 'ok' }, 200, headers);
}

async function handleNotificarRecusa(request, env, headers) {
  const body = await request.json();
  const { vendedorEmail, vendedorNome, tipo, formUrl, motivoRecusa } = body;

  if (!vendedorEmail || !tipo) {
    return json({ status: 'error', message: 'vendedorEmail e tipo são obrigatórios' }, 400, headers);
  }

  const tipoLabel = TIPO_LABEL[tipo] || tipo;

  await enviarEmail(env, {
    to: vendedorEmail,
    subject: `Solicitação de treinamento recusada — ${tipoLabel}`,
    html: `
      <p>Olá${vendedorNome ? ` ${vendedorNome}` : ''},</p>
      <p>Sua solicitação de treinamento (${tipoLabel}) foi recusada.</p>
      ${motivoRecusa ? `<p><strong>Motivo:</strong> ${motivoRecusa}</p>` : ''}
      <p>Você pode enviar uma nova solicitação com outras datas:</p>
      ${formUrl ? `<p><a href="${formUrl}">Enviar nova solicitação</a></p>` : ''}
    `
  });

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
      if (url.pathname === '/notificar-recusa' && request.method === 'POST') {
        return await handleNotificarRecusa(request, env, headers);
      }
    } catch (err) {
      console.error('erro não tratado:', err.stack || err.message || err);
      return json({ status: 'error', message: err.message || 'erro interno' }, 500, headers);
    }

    return json({ status: 'not_implemented', message: 'Rota não encontrada.' }, 501, headers);
  }
};

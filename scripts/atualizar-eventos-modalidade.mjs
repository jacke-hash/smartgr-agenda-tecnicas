import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Atualiza (PATCH) os eventos do Google Calendar já criados para incluir a
// modalidade (Online/Presencial) no título e na descrição — mesma lógica do
// worker/calendar/src/index.js, aplicada retroativamente via /atualizar-evento.
// Requer GOOGLE_APPLICATION_CREDENTIALS (service account) e
// CALENDAR_WORKER_URL (ou usa o default abaixo).

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const CALENDAR_WORKER_URL = process.env.CALENDAR_WORKER_URL || 'https://smartgr-agenda-tecnicas-calendar.jacke-a59.workers.dev';
const COLECOES = ['solicitacoes_consumidor_final', 'solicitacoes_revenda', 'solicitacoes_workshop'];
const SUFIXOS_TECNICA = ['', '2', '3', '4', '5'];
const DRY_RUN = !process.argv.includes('--apply');

function campo(nomeBase, sufixo) {
  return `${nomeBase}${sufixo}`;
}

function dadosDeLocal(item) {
  const revendaCliente = item.tipo === 'revenda' && item.destinoTreinamento === 'cliente_revenda';
  const modalidade = item.tipo === 'workshop' ? 'presencial' : revendaCliente ? item.tipoTreinamentoCliente : item.modalidade;
  const endereco = revendaCliente ? item.enderecoCliente || null : item.endereco || null;
  return { modalidade, endereco };
}

async function processarColecao(colecaoNome) {
  const snap = await db.collection(colecaoNome).where('status', '==', 'aprovado').get();
  let atualizados = 0;
  let ignorados = 0;
  let falhas = 0;

  for (const docSnap of snap.docs) {
    const item = { _id: docSnap.id, _colecao: colecaoNome, ...docSnap.data() };
    if (!item.dataEscolhida) { ignorados++; continue; }

    const { modalidade, endereco } = dadosDeLocal(item);
    const localAgendamento = item.localAgendamento || null;
    const nomeSolicitante = item.vendedor || item.vendedorAcompanha || '—';
    const { _id, _colecao, criadoEm, slaExpiraEm, aprovadoEm, status, opcoesData, dataEscolhida, ...solicitacao } = item;

    const slots = SUFIXOS_TECNICA
      .map((sufixo) => ({ sufixo, tecnicaId: item[campo('tecnicaAtribuida', sufixo)], eventId: item[campo('googleEventId', sufixo)] }))
      .filter((s) => s.tecnicaId && s.eventId);

    for (const slot of slots) {
      const payload = {
        tecnicaId: slot.tecnicaId,
        eventId: slot.eventId,
        tipo: item.tipo,
        tipoTreinamento: item.tipoTreinamento || null,
        tipoReserva: item.tipoReserva || 'unico',
        modalidade,
        endereco,
        unidade: item.unidade || null,
        localAgendamento,
        nomeSolicitante,
        dataHora: dataEscolhida,
        solicitacao
      };

      if (DRY_RUN) {
        console.log(`[dry-run] ${colecaoNome}/${item._id} slot ${slot.sufixo || '1'} eventId=${slot.eventId} modalidade=${modalidade}`);
        atualizados++;
        continue;
      }

      try {
        const resp = await fetch(`${CALENDAR_WORKER_URL}/atualizar-evento`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resultado = await resp.json();
        if (!resp.ok) {
          console.error(`FALHA ${colecaoNome}/${item._id} slot ${slot.sufixo || '1'}:`, resultado.message || resultado);
          falhas++;
        } else {
          console.log(`OK ${colecaoNome}/${item._id} slot ${slot.sufixo || '1'} (${modalidade})`);
          atualizados++;
        }
      } catch (err) {
        console.error(`ERRO ${colecaoNome}/${item._id} slot ${slot.sufixo || '1'}:`, err.message);
        falhas++;
      }
      // Evita estourar rate limit da Calendar API / troca de token por técnica.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return { atualizados, ignorados, falhas };
}

async function main() {
  if (DRY_RUN) console.log('--- DRY RUN (nada será alterado; rode com --apply pra aplicar de verdade) ---');
  let totalAtualizados = 0, totalIgnorados = 0, totalFalhas = 0;
  for (const colecao of COLECOES) {
    const { atualizados, ignorados, falhas } = await processarColecao(colecao);
    totalAtualizados += atualizados;
    totalIgnorados += ignorados;
    totalFalhas += falhas;
  }
  console.log(`\nConcluído. Eventos atualizados: ${totalAtualizados}, ignorados (sem data): ${totalIgnorados}, falhas: ${totalFalhas}`);
}

main().catch((err) => {
  console.error('Erro ao rodar script:', err);
  process.exit(1);
});

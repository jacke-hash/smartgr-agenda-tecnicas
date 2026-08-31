// Compartilhado entre painel-julia.js e minhas-solicitacoes.js — mesmo
// rótulo/cor pros 3 tipos de fluxo em qualquer lista de solicitações.
export const TAG_TIPO = {
  consumidor_final: { label: 'Consumidor Final', cls: 'consumidor_final' },
  revenda: { label: 'Revendas/Redes', cls: 'revenda' },
  workshop: { label: 'Workshop', cls: 'workshop' }
};

export function formatDataHora(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

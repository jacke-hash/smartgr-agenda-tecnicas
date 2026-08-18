import './../styles/main.css';

/**
 * Tela pública (sem login no portal) que a técnica abre uma única vez para
 * conectar sua agenda Google (escopo calendar.events). O worker de calendar
 * redireciona de volta pra cá com ?status=sucesso|erro após o OAuth.
 */
const MOTIVO_LABEL = {
  sem_code: 'Autorização cancelada ou incompleta.',
  sem_refresh_token:
    'O Google não retornou permissão de acesso offline. Tente novamente e aceite todas as permissões solicitadas.',
  conta_invalida: 'A conta usada não é uma conta @smartgr.com.br válida.',
  tecnica_nao_encontrada: 'Este e-mail não está cadastrado como técnica no sistema.',
  falha_interna: 'Ocorreu um erro ao conectar sua agenda. Tente novamente.'
};

function parseHashParams() {
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

export function renderConectarAgendaTecnica(container) {
  const params = parseHashParams();
  const status = params.get('status');
  const motivo = params.get('motivo');
  const workerUrl = import.meta.env.VITE_CALENDAR_WORKER_URL;

  let feedbackHtml = '';
  if (status === 'sucesso') {
    feedbackHtml = `<div class="advance-note" style="max-width:420px;">✅ Agenda conectada com sucesso! Você já pode fechar esta aba.</div>`;
  } else if (status === 'erro') {
    feedbackHtml = `<div class="error-note" style="max-width:420px;">⚠️ ${MOTIVO_LABEL[motivo] || 'Não foi possível conectar sua agenda.'}</div>`;
  }

  container.innerHTML = `
    <div class="login-wrap">
      <h1>Conectar minha agenda</h1>
      <p>Conecte sua Google Agenda uma única vez para receber automaticamente os treinamentos atribuídos a você.</p>
      ${feedbackHtml}
      ${
        workerUrl
          ? `<button class="google-btn" id="btn-conectar">Conectar com Google Workspace</button>`
          : `<div class="error-note" style="max-width:420px;">Integração ainda não configurada (VITE_CALENDAR_WORKER_URL ausente).</div>`
      }
    </div>
  `;

  const btn = container.querySelector('#btn-conectar');
  if (btn) {
    btn.addEventListener('click', () => {
      const origin = window.location.origin;
      window.location.href = `${workerUrl}/oauth/iniciar?origin=${encodeURIComponent(origin)}`;
    });
  }
}

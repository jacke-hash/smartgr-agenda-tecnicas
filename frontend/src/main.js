import './styles/main.css';
import { observarAuth, loginComGoogle, logout } from './auth.js';
import { renderLanding } from './pages/landing.js';
import { renderFormConsumidorFinal } from './pages/form-consumidor-final.js';
import { renderFormRevenda } from './pages/form-revenda.js';
import { renderFormWorkshop } from './pages/form-workshop.js';
import { renderPainelJulia } from './pages/painel-julia.js';
import { renderConectarAgendaTecnica } from './pages/conectar-agenda-tecnica.js';
import { renderMinhasSolicitacoes } from './pages/minhas-solicitacoes.js';
import { renderEscalaTecnicas } from './pages/escala-tecnicas.js';

const app = document.getElementById('app');

const ROUTES = {
  '#/': renderLanding,
  '#/revenda': renderFormRevenda,
  '#/consumidor-final': renderFormConsumidorFinal,
  '#/workshop': renderFormWorkshop,
  '#/painel': renderPainelJulia,
  '#/conectar-agenda': renderConectarAgendaTecnica,
  '#/minhas-solicitacoes': renderMinhasSolicitacoes,
  '#/escala': renderEscalaTecnicas
};

function navigate(rota) {
  window.location.hash = rota;
}

// Mesma dupla usada em firestore.rules (isAprovador) — Jacke como admin
// master, Julia como aprovadora natural do fluxo.
const ADMINS_PAINEL = ['julia@smartgr.com.br', 'jacke@smartgr.com.br'];

function podeVerPainel(user) {
  return Boolean(user?.email) && ADMINS_PAINEL.includes(user.email.toLowerCase());
}

function renderShell(user) {
  app.innerHTML = `
    <div class="topbar">
      <div class="brand"><span class="dot"></span> Agenda de Treinamento — Técnicas</div>
      <div class="topbar-right">
        <div class="view-switch">
          <button data-rota="#/">Nova solicitação</button>
          <button data-rota="#/minhas-solicitacoes">Minhas Solicitações</button>
          ${podeVerPainel(user) ? `<button data-rota="#/painel">Painel — Julia</button>` : ''}
          ${podeVerPainel(user) ? `<button data-rota="#/escala">Escala</button>` : ''}
        </div>
        <div class="user-chip">
          ${user.photoURL ? `<img src="${user.photoURL}" alt="" />` : ''}
          <span>${user.displayName || user.email}</span>
        </div>
        <button class="logout-btn" id="btn-logout">Sair</button>
      </div>
    </div>
    <div class="page" id="page-content"></div>
  `;

  app.querySelectorAll('.view-switch button').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.rota));
  });

  document.getElementById('btn-logout').addEventListener('click', () => logout());

  renderRotaAtual(user);
}

let cleanupRotaAtual = null;

function renderRotaAtual(user) {
  const rota = window.location.hash || '#/';
  const pageContent = document.getElementById('page-content');
  if (!pageContent) return;

  if (typeof cleanupRotaAtual === 'function') {
    cleanupRotaAtual();
    cleanupRotaAtual = null;
  }

  const rotaBase = rota.split('?')[0];

  if ((rotaBase === '#/painel' || rotaBase === '#/escala') && !podeVerPainel(user)) {
    navigate('#/');
    return;
  }

  const switchButtons = app.querySelectorAll('.view-switch button');
  switchButtons.forEach((btn) => {
    btn.classList.toggle(
      'active',
      btn.dataset.rota === rota ||
        (rota.startsWith('#/') && btn.dataset.rota === '#/' && !['#/painel', '#/escala', '#/minhas-solicitacoes'].includes(rota))
    );
  });

  const renderer = ROUTES[rotaBase] || renderLanding;
  pageContent.innerHTML = '';
  cleanupRotaAtual = renderer(pageContent, navigate, user) || null;
}

function renderLoginScreen() {
  app.innerHTML = `
    <div class="login-wrap">
      <h1>Agenda de Treinamento — Técnicas</h1>
      <p>Acesso restrito a contas @smartgr.com.br</p>
      <button class="google-btn" id="btn-login">Entrar com Google</button>
      <div id="login-error" style="color:#C4293A;font-size:13px;"></div>
    </div>
  `;

  document.getElementById('btn-login').addEventListener('click', async () => {
    const errorBox = document.getElementById('login-error');
    errorBox.textContent = '';
    try {
      await loginComGoogle();
    } catch (err) {
      errorBox.textContent = err.message || 'Erro ao entrar.';
    }
  });
}

const ROTA_PUBLICA = '#/conectar-agenda';

function ehRotaPublica() {
  return (window.location.hash || '').startsWith(ROTA_PUBLICA);
}

let usuarioAtual = null;

function bootstrap() {
  if (ehRotaPublica()) {
    app.innerHTML = '<div class="page" id="page-content"></div>';
    renderConectarAgendaTecnica(document.getElementById('page-content'), navigate, null);
    return;
  }

  observarAuth((user) => {
    usuarioAtual = user;
    if (user) {
      renderShell(user);
    } else {
      renderLoginScreen();
    }
  });
}

window.addEventListener('hashchange', () => {
  if (ehRotaPublica()) {
    bootstrap();
    return;
  }
  if (usuarioAtual) {
    renderRotaAtual(usuarioAtual);
  } else {
    bootstrap();
  }
});

bootstrap();

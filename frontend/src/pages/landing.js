export function renderLanding(container, navigate) {
  container.innerHTML = `
    <div class="path-wrap">
      <h1>Quem vai receber o treinamento?</h1>
      <p>Escolha uma opção para abrir o formulário correto</p>
      <div class="path-cards">
        <div class="path-card revenda" data-rota="#/revenda">
          <div class="icon">🏬</div>
          <h3>Revenda</h3>
          <p>Treinamento para o time da revenda ou para um cliente atendido pela revenda</p>
        </div>
        <div class="path-card final" data-rota="#/consumidor-final">
          <div class="icon">🙋</div>
          <h3>Consumidor Final</h3>
          <p>Treinamento direto para o profissional ou clínica que comprou o equipamento</p>
        </div>
        <div class="path-card workshop" data-rota="#/workshop">
          <div class="icon">🎓</div>
          <h3>Workshop</h3>
          <p>Ação institucional em faculdades, eventos ou instituições de ensino</p>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.path-card').forEach((card) => {
    card.addEventListener('click', () => navigate(card.dataset.rota));
  });
}

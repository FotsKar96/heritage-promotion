(() => {
  'use strict';
  const catalog = document.querySelector('[data-waterfall-catalog]');
  if (!catalog) return;
  const controls = catalog.querySelector('[data-waterfall-filters]');
  const buttons = [...catalog.querySelectorAll('[data-waterfall-filter]')];
  const cards = [...catalog.querySelectorAll('[data-waterfall-group]')];
  const status = catalog.querySelector('[data-waterfall-count]');
  const labels = { all: 'Όλοι', mainland: 'Ηπειρωτική Ελλάδα', islands: 'Νησιά' };
  if (!controls || !status || !cards.length) return;

  function selectedGroup() {
    const value = new URL(window.location.href).searchParams.get('perioxi') || 'all';
    return Object.hasOwn(labels, value) ? value : 'all';
  }

  function apply(group, updateURL = false) {
    if (!Object.hasOwn(labels, group)) group = 'all';
    let count = 0;
    cards.forEach(card => {
      card.hidden = group !== 'all' && card.dataset.waterfallGroup !== group;
      if (!card.hidden) count += 1;
    });
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.waterfallFilter === group)));
    status.textContent = group === 'all'
      ? `Εμφανίζονται ${count} από ${cards.length} καταρράκτες.`
      : `${labels[group]}: ${count} από ${cards.length} καταρράκτες.`;
    if (updateURL) {
      const url = new URL(window.location.href);
      if (group === 'all') url.searchParams.delete('perioxi');
      else url.searchParams.set('perioxi', group);
      try { window.history.pushState({}, '', url); } catch { /* Filtering remains usable. */ }
    }
  }

  buttons.forEach(button => button.addEventListener('click', () => apply(button.dataset.waterfallFilter, true)));
  window.addEventListener('popstate', () => apply(selectedGroup()));
  apply(selectedGroup());
  controls.hidden = false;
})();

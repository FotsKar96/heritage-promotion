(() => {
  'use strict';

  const widget = document.querySelector('[data-site-search]');
  if (!widget) return;
  const form = widget.querySelector('form');
  const input = widget.querySelector('input[type="search"]');
  const panel = widget.querySelector('.site-search-panel');
  const status = widget.querySelector('.site-search-status');
  const list = widget.querySelector('.site-search-results');
  const indexURL = new URL(widget.dataset.indexUrl, window.location.href);
  const projectPath = indexURL.pathname.replace(/search\.json$/, '');
  let indexPromise = null;
  let requestNumber = 0;
  let timer;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalize = value => clean(value).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('el-GR').replace(/ς/g, 'σ');
  const tokensFor = value => [...new Set(normalize(value).match(/[\p{L}\p{N}]+/gu) || [])];

  function closeResults() {
    requestNumber += 1;
    panel.hidden = true;
  }

  function prepareRecords(data) {
    if (!Array.isArray(data)) throw new Error('Invalid search index');
    const unique = new Map();
    for (const row of data) {
      if (!row || !clean(row.title) || typeof row.url !== 'string') continue;
      const url = new URL(row.url, indexURL);
      if (url.origin !== indexURL.origin || !url.pathname.startsWith(projectPath)) continue;
      const item = {
        title: clean(row.title), url: url.href, area: clean(row.area),
        description: clean(row.description), content: clean(row.content)
      };
      item.titleKey = normalize(item.title);
      item.areaKey = normalize(item.area);
      item.descriptionKey = normalize(item.description);
      item.contentKey = normalize(item.content);
      item.textKey = [item.titleKey, item.areaKey, item.descriptionKey, item.contentKey].join(' ');
      unique.set(item.url, item);
    }
    return [...unique.values()];
  }

  function getIndex() {
    if (!indexPromise) {
      indexPromise = fetch(indexURL.href, { credentials: 'same-origin', cache: 'no-cache' })
        .then(response => {
          if (!response.ok) throw new Error('Search index unavailable');
          return response.json();
        })
        .then(prepareRecords)
        .catch(error => { indexPromise = null; throw error; });
    }
    return indexPromise;
  }

  function score(item, words, phrase) {
    let value = item.titleKey === phrase ? 1000 : item.titleKey.includes(phrase) ? 200 : 0;
    for (const word of words) {
      if (item.titleKey.includes(word)) value += 80;
      if (item.areaKey.includes(word)) value += 50;
      if (item.descriptionKey.includes(word)) value += 15;
      if (item.contentKey.includes(word)) value += 2;
    }
    return value;
  }

  function excerptFor(item, words) {
    const text = item.content || item.description;
    if (!text) return '';
    const key = normalize(text);
    const positions = words.map(word => key.indexOf(word)).filter(position => position >= 0);
    const start = positions.length ? Math.max(0, Math.min(...positions) - 45) : 0;
    const end = Math.min(text.length, start + 175);
    return (start ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  }

  function showResults(items, words, query) {
    list.replaceChildren();
    if (!items.length) {
      status.textContent = `Δεν βρέθηκαν αποτελέσματα για «${query}». Δοκιμάστε άλλη λέξη ή περιοχή.`;
      return;
    }
    status.textContent = items.length === 1 ? 'Βρέθηκε 1 αποτέλεσμα.' : `Βρέθηκαν ${items.length} αποτελέσματα.`;
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = item.url;
      link.textContent = item.title;
      li.append(link);
      if (item.area) {
        const area = document.createElement('span');
        area.className = 'site-search-result-area';
        area.textContent = item.area;
        li.append(area);
      }
      const excerpt = excerptFor(item, words);
      if (excerpt) {
        const paragraph = document.createElement('p');
        paragraph.className = 'site-search-result-excerpt';
        paragraph.textContent = excerpt;
        li.append(paragraph);
      }
      fragment.append(li);
    }
    list.append(fragment);
  }

  async function search() {
    const query = clean(input.value).slice(0, 100);
    const words = tokensFor(query);
    const thisRequest = ++requestNumber;
    list.replaceChildren();
    if (words.join('').length < 2) {
      status.textContent = 'Γράψτε τουλάχιστον δύο χαρακτήρες για αναζήτηση.';
      panel.hidden = !query;
      return;
    }
    panel.hidden = false;
    status.textContent = 'Αναζήτηση…';
    try {
      const records = await getIndex();
      if (thisRequest !== requestNumber) return;
      const phrase = normalize(query);
      const matches = records.filter(item => words.every(word => item.textKey.includes(word)))
        .map(item => ({ item, score: score(item, words, phrase) }))
        .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'el'))
        .map(result => result.item);
      showResults(matches, words, query);
    } catch {
      if (thisRequest !== requestNumber) return;
      status.textContent = 'Η αναζήτηση δεν φόρτωσε. Πατήστε τον φακό για νέα προσπάθεια.';
    }
  }

  input.addEventListener('input', event => {
    clearTimeout(timer);
    requestNumber += 1;
    if (event.isComposing) return;
    if (!clean(input.value)) {
      list.replaceChildren();
      closeResults();
      return;
    }
    timer = setTimeout(search, 180);
  });
  input.addEventListener('compositionend', () => { clearTimeout(timer); timer = setTimeout(search, 180); });
  input.addEventListener('focus', () => {
    if (tokensFor(input.value).join('').length >= 2) { clearTimeout(timer); search(); }
  });
  form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); search(); });
  widget.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearTimeout(timer);
      input.focus();
      closeResults();
    } else if (event.key === 'ArrowDown' && event.target === input && !panel.hidden) {
      const first = list.querySelector('a');
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!widget.contains(event.target)) { clearTimeout(timer); closeResults(); }
  });
  widget.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!widget.contains(document.activeElement)) { clearTimeout(timer); closeResults(); }
    }, 0);
  });
})();

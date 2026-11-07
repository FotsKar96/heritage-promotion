(async () => {
  'use strict';

  const table = document.getElementById('dp-table');
  if (!table || table.dataset.liveDataStarted) return;
  table.dataset.liveDataStarted = 'true';

  const status = document.getElementById('dp-live-status');
  const rows = new Map([...table.querySelectorAll('tbody tr[data-qid]')]
    .map(row => [row.dataset.qid, row]));
  const entities = new Map();
  const redirects = new Map();
  const numberFormat = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 5 });
  const datasetUrl = table.dataset.liveDataUrl;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function link(url, text, className) {
    const node = element('a', className, text);
    const href = safeUrl(url);
    if (href) node.href = href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    return node;
  }

  async function requestJson(address) {
    const response = await fetch(address, {
      credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (data.error) throw new Error(data.error.info || data.error.code);
    return data;
  }

  async function requestApi(origin, parameters) {
    const query = new URLSearchParams({
      ...parameters, format: 'json', formatversion: '2', origin: '*'
    });
    return requestJson(origin + '/w/api.php?' + query);
  }

  function entityFor(qid) {
    const visited = new Set();
    while (redirects.has(qid) && !visited.has(qid)) {
      visited.add(qid);
      qid = redirects.get(qid);
    }
    return entities.get(qid);
  }

  async function fetchEntities(ids) {
    const missing = [...new Set(ids)].filter(id => /^Q[1-9]\d*$/.test(id) && !entityFor(id));
    for (let offset = 0; offset < missing.length; offset += 50) {
      const data = await requestApi('https://www.wikidata.org', {
        action: 'wbgetentities', ids: missing.slice(offset, offset + 50).join('|'),
        props: 'labels|descriptions|claims|sitelinks', languages: 'el|en', redirects: '1'
      });
      for (const item of Object.values(data.entities || {})) entities.set(item.id, item);
      for (const item of data.redirects || []) redirects.set(item.from, item.to);
    }
  }

  function statements(entity, property) {
    const values = (entity?.claims?.[property] || []).filter(statement =>
      statement.rank !== 'deprecated' && statement.mainsnak?.snaktype === 'value' &&
      statement.mainsnak.datavalue);
    const preferred = values.filter(statement => statement.rank === 'preferred');
    return preferred.length ? preferred : values;
  }

  function itemIds(entity, property) {
    return statements(entity, property).map(statement => statement.mainsnak.datavalue.value?.id)
      .filter(id => /^Q[1-9]\d*$/.test(id || ''));
  }

  function label(entity) {
    return entity?.labels?.el?.value || entity?.labels?.en?.value || '';
  }

  function uniqueStatement(entity, property) {
    const values = statements(entity, property);
    return values.length === 1 ? values[0] : null;
  }

  async function loadAdministration(records) {
    let frontier = records.filter(record => record.live_administration !== false)
      .flatMap(record => itemIds(entityFor(record.qid), 'P131'));
    const visited = new Set();
    for (let depth = 0; depth < 7 && frontier.length; depth++) {
      const next = [...new Set(frontier)].filter(qid => !visited.has(qid));
      if (!next.length) break;
      await fetchEntities(next);
      next.forEach(qid => visited.add(qid));
      frontier = next.flatMap(qid => itemIds(entityFor(qid), 'P131'));
    }
  }

  function administrativeValues(entity) {
    const units = new Map();
    const regions = new Map();
    const queue = itemIds(entity, 'P131');
    const visited = new Set();
    while (queue.length) {
      const qid = queue.shift();
      if (visited.has(qid)) continue;
      visited.add(qid);
      const parent = entityFor(qid);
      const types = itemIds(parent, 'P31');
      if (types.includes('Q1234255') && label(parent)) units.set(qid, label(parent));
      if (types.includes('Q207299') && label(parent)) regions.set(qid, label(parent));
      queue.push(...itemIds(parent, 'P131'));
    }
    return { units, regions };
  }

  function source(qid, labelText = 'Wikidata') {
    return { label: labelText, url: 'https://www.wikidata.org/wiki/' + qid };
  }

  function effectiveRecord(record) {
    const result = { ...record, live: {} };
    const entity = entityFor(record.qid);
    if (entity?.labels?.el?.value) {
      result.name = entity.labels.el.value;
      result.live.name = source(record.qid);
    }

    const coordinateStatement = uniqueStatement(entity, 'P625');
    const coordinate = coordinateStatement?.mainsnak.datavalue.value;
    if (coordinate && Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude) &&
        Math.abs(coordinate.latitude) <= 90 && Math.abs(coordinate.longitude) <= 180 &&
        (!coordinate.globe || /\/Q2$/.test(coordinate.globe))) {
      result.latitude = coordinate.latitude;
      result.longitude = coordinate.longitude;
      result.live.coordinates = source(record.qid, 'Wikidata P625');
    }

    if (record.live_height_qid) {
      const statement = uniqueStatement(entityFor(record.live_height_qid), 'P2048');
      const quantity = statement?.mainsnak.datavalue.value;
      const amount = Number(quantity?.amount);
      if (quantity && /\/Q11573$/.test(quantity.unit || '') && Number.isFinite(amount) && amount >= 0 &&
          !Object.keys(statement.qualifiers || {}).length) {
        result.height_m = amount;
        result.height_approximate = Boolean(quantity.lowerBound && quantity.upperBound &&
          quantity.lowerBound !== quantity.upperBound);
        result.height_note = 'Τιμή από το πεδίο P2048 της συγκεκριμένης καταχώρισης Wikidata.';
        result.live.height = source(record.live_height_qid, 'Wikidata P2048');
      }
    }

    if (record.live_administration !== false) {
      const administration = administrativeValues(entity);
      if (administration.units.size === 1) {
        const [qid, name] = [...administration.units][0];
        result.regional_unit = name.replace(/^Περιφερειακή\s+ενότητα\s+/iu, '');
        result.live.regional_unit = source(qid);
      }
      if (administration.regions.size === 1) {
        const [qid, name] = [...administration.regions][0];
        result.region = name.replace(/^Περιφέρεια\s+/iu, '');
        result.region_qid = qid;
        result.live.region = source(qid);
      }
    }
    return result;
  }

  function heightText(record) {
    if (typeof record.height_m !== 'number' || !Number.isFinite(record.height_m)) {
      return 'Δεν έχει διασταυρωθεί';
    }
    return (record.height_approximate ? 'Περίπου ' : '') + numberFormat.format(record.height_m) + ' μ.';
  }

  function sourcesFor(record) {
    const unique = new Map();
    for (const item of [...(record.sources || []), ...Object.values(record.live || {})]) {
      const url = safeUrl(item.url);
      if (url) unique.set(url, { label: item.label || 'Πηγή', url });
    }
    return [...unique.values()];
  }

  function addFieldSource(field, item) {
    if (!item) return;
    const credit = element('span', 'dp-field-src');
    credit.append('Πηγή: ', link(item.url, item.label));
    field.append(credit);
  }

  function accessBadge(record) {
    const code = ['Α', 'Β', 'Γ'].includes(record.access_code) ? record.access_code : 'Γ';
    const badge = element('span', 'dp-access dp-access-' + code, code);
    badge.title = record.access_text || '';
    return badge;
  }

  function renderRecord(record) {
    const row = rows.get(record.qid);
    const card = document.getElementById('poi-' + row.dataset.slug);
    const fields = [...card.querySelectorAll('.dp-fields dd')];
    const cells = [...row.cells];
    if (fields.length !== 12 || cells.length !== 8) return;
    const sources = sourcesFor(record);
    const height = heightText(record);
    const statusCode = record.documentation_status === 'full' ? 'full' : 'limited';
    const statusText = statusCode === 'full' ? 'επαρκής' : 'περιορισμένη';

    if (!row.dataset.searchAliases) {
      row.dataset.searchAliases = [row.dataset.name, row.dataset.pe, row.dataset.region].filter(Boolean).join(' ');
    }
    Object.assign(row.dataset, {
      name: record.name || '', pe: record.regional_unit || '', region: record.region || '',
      height: typeof record.height_m === 'number' && Number.isFinite(record.height_m) ? String(record.height_m) : '',
      access: record.access_code || 'Γ', activities: record.activities || '', season: record.seasonality || '',
      sources: String(sources.length), status: statusCode,
      regionQid: record.region_qid || record.region || '',
      scientificStudy: record.has_scientific_study === true ? 'true' : 'false',
      lat: String(record.latitude ?? ''), lon: String(record.longitude ?? '')
    });
    cells[0].querySelector('a').textContent = record.name;
    cells[1].replaceChildren(record.regional_unit || '', element('span', 'dp-region-inline', record.region));
    const heightNode = element('strong', typeof record.height_m === 'number' ? '' : 'dp-unknown', height);
    const heightSource = record.live.height || record.sources?.[0];
    const heightCredit = element('span', 'dp-src');
    if (heightSource) heightCredit.append(link(heightSource.url, heightSource.label));
    cells[2].replaceChildren(heightNode, heightCredit);
    cells[3].replaceChildren(accessBadge(record));
    cells[4].textContent = record.activities || '';
    cells[5].textContent = record.seasonality || '';
    cells[6].replaceChildren(link(source(record.qid).url, record.qid));
    cells[7].replaceChildren();
    if (sources[0]) cells[7].append(link(sources[0].url, 'Πηγή ↗'));
    if (sources.length > 1) cells[7].append(element('span', 'dp-more', '+' + (sources.length - 1)));

    card.querySelector('.dp-card-title a').textContent = record.name;
    card.querySelector('.dp-card-meta').textContent = record.regional_unit + ' · ' + record.region;
    card.querySelector('.dp-chip').textContent = height;
    const badge = card.querySelector('summary .dp-status');
    badge.className = 'dp-status dp-status-' + statusCode;
    badge.textContent = statusText;

    fields[0].replaceChildren(record.name || '');
    addFieldSource(fields[0], record.live.name);
    fields[1].replaceChildren(record.regional_unit || '');
    addFieldSource(fields[1], record.live.regional_unit);
    fields[2].replaceChildren(record.region || '');
    addFieldSource(fields[2], record.live.region);
    fields[3].replaceChildren(element('strong', 'dp-big', height),
      element('span', 'dp-field-note', record.height_note || ''));
    addFieldSource(fields[3], heightSource);
    fields[4].textContent = record.landscape || '';
    fields[5].replaceChildren(accessBadge(record), ' ' + (record.access_text || ''));
    fields[6].textContent = record.activities || '';
    fields[7].replaceChildren(record.seasonality || '',
      element('span', 'dp-field-note', record.seasonality_note || ''));

    fields[8].replaceChildren();
    if (typeof record.latitude === 'number' && typeof record.longitude === 'number') {
      const coordinates = record.latitude.toFixed(5) + ', ' + record.longitude.toFixed(5);
      const mapUrl = new URL('https://www.openstreetmap.org/');
      mapUrl.search = new URLSearchParams({ mlat: record.latitude, mlon: record.longitude });
      mapUrl.hash = 'map=15/' + record.latitude + '/' + record.longitude;
      fields[8].append(element('span', 'dp-mono', coordinates), link(mapUrl.href, 'OpenStreetMap ↗', 'dp-mini'));
    }
    addFieldSource(fields[8], record.live.coordinates);
    fields[9].replaceChildren(link(source(record.qid).url, record.qid + ' ↗'));
    const sourceList = element('ul', 'dp-src-list');
    for (const item of sources) {
      const listItem = element('li');
      listItem.append(link(item.url, item.label + ' ↗'));
      sourceList.append(listItem);
    }
    fields[10].replaceChildren(sourceList);
    fields[11].replaceChildren(element('span', 'dp-status dp-status-' + statusCode, statusText),
      element('span', 'dp-tier', record.documentation_tier || ''));
    const documentation = card.querySelector('.dp-doc-box');
    if (documentation) {
      documentation.className = 'dp-doc-box dp-doc-' + statusCode;
      documentation.querySelector('p').textContent = record.documentation_note || '';
    }
  }

  function refreshControls() {
    const current = [...rows.values()];
    const totals = {
      'σημεία': current.length,
      'περιφέρειες': new Set(current.map(row => row.dataset.regionQid || row.dataset.region)).size,
      'επαρκής τεκμηρίωση': current.filter(row => row.dataset.status === 'full').length,
      'περιορισμένη': current.filter(row => row.dataset.status !== 'full').length,
      'χωρίς ύψος': current.filter(row => row.dataset.height === '').length,
      'επιστημονική μελέτη': current.filter(row => row.dataset.scientificStudy === 'true').length
    };
    for (const item of document.querySelectorAll('.dp-stats li')) {
      const caption = item.querySelector('span')?.textContent.trim();
      if (Object.hasOwn(totals, caption)) item.querySelector('strong').textContent = totals[caption];
    }
    document.dispatchEvent(new CustomEvent('waterfall-data-updated'));
  }

  function descriptionBox(record) {
    const card = document.getElementById('poi-' + rows.get(record.qid).dataset.slug);
    const block = card.querySelector('.dp-wiki');
    let output = block.querySelector('.dp-live-description');
    if (!output) {
      output = element('div', 'dp-live-description');
      block.append(output);
    }
    return { block, output };
  }

  function renderDescription(output, text, item, licenseName, licenseUrl) {
    const credit = element('p');
    credit.append(link(item.url, item.label), ' · ', link(licenseUrl, licenseName));
    output.replaceChildren(element('p', 'dp-field-note', 'Περιγραφή που αντλείται αυτόματα'),
      element('p', '', text), credit);
  }

  async function loadDescriptions(records) {
    for (const record of records) {
      const entity = entityFor(record.qid);
      const { block, output } = descriptionBox(record);
      renderDescription(output, entity?.descriptions?.el?.value || 'Δεν υπάρχει διαθέσιμη ελληνική περιγραφή.',
        source(record.qid), 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/');
      const title = entity?.sitelinks?.elwiki?.title;
      const note = block.querySelector('.dp-wiki-note');
      if (note) note.textContent = title ? 'Λήμμα: «' + title + '»' : 'Δεν έχει συνδεθεί ελληνικό λήμμα στο Wikidata.';
      if (!title) continue;
      const editLink = block.querySelector('.dp-wiki-buttons a[href*="el.wikipedia.org"]');
      if (editLink) {
        editLink.href = 'https://el.wikipedia.org/w/index.php?' + new URLSearchParams({ title, action: 'edit' });
        editLink.textContent = 'Επεξεργασία λήμματος ↗';
      }
      try {
        const wiki = await requestApi('https://el.wikipedia.org', {
          action: 'query', prop: 'extracts', titles: title, redirects: '1',
          exintro: '1', explaintext: '1', exchars: '700'
        });
        const page = wiki.query?.pages?.[0];
        if (!page?.extract) throw new Error('Το απόσπασμα λείπει.');
        renderDescription(output, page.extract, {
          label: 'Wikipedia · λήμμα και συντάκτες',
          url: 'https://el.wikipedia.org/wiki/' + encodeURIComponent(page.title)
        }, 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/');
      } catch (error) {
        console.warn('Περιγραφή από Wikidata για ' + record.qid, error);
      }
    }
  }

  function validateRecord(record) {
    return record && rows.has(record.qid) && /^Q[1-9]\d*$/.test(record.qid) &&
      typeof record.name === 'string' && Array.isArray(record.sources) &&
      typeof record.regional_unit === 'string' && typeof record.region === 'string';
  }

  let records;
  try {
    const dataset = await requestJson(datasetUrl);
    if (dataset.schema_version !== 1 || !Array.isArray(dataset.records)) throw new Error('Μη υποστηριζόμενη δομή JSON.');
    const unique = new Map();
    for (const record of dataset.records.filter(validateRecord)) unique.set(record.qid, record);
    records = [...unique.values()];
    if (!records.length) throw new Error('Δεν βρέθηκαν έγκυρες καταχωρίσεις.');
    records.forEach(record => renderRecord({ ...record, live: {} }));
    refreshControls();
    if (status) status.textContent = 'Φορτώθηκαν ' + records.length + ' καταχωρίσεις από το κεντρικό αρχείο. Γίνεται σύνδεση με το Wikidata.';
  } catch (error) {
    if (status) status.textContent = 'Δεν φορτώθηκε το κεντρικό αρχείο. Εμφανίζονται τα αποθηκευμένα στοιχεία της σελίδας.';
    console.warn('Αποτυχία φόρτωσης waterfalls.json.', error);
    return;
  }

  try {
    await fetchEntities(records.flatMap(record => [record.qid, record.live_height_qid].filter(Boolean)));
    let administrationFailed = false;
    try {
      await loadAdministration(records);
    } catch (error) {
      administrationFailed = true;
      console.warn('Η διοικητική αλυσίδα φορτώθηκε μερικώς.', error);
    }
    const effective = records.map(effectiveRecord);
    effective.forEach(renderRecord);
    refreshControls();
    const time = new Intl.DateTimeFormat('el-GR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    if (status) {
      status.textContent = records.length + ' καταχωρίσεις από waterfalls.json και διαθέσιμες τιμές Wikidata. ' +
        'Πρόσβαση, δραστηριότητες, εποχικότητα και αξιολόγηση διαβάζονται από το επιμελημένο JSON. ' +
        'Τελευταία φόρτωση ' + time + '.' +
        (administrationFailed ? ' Ορισμένα διοικητικά στοιχεία διαβάζονται από το JSON.' : '');
    }
    await loadDescriptions(records);
  } catch (error) {
    if (status) status.textContent = 'Το Wikidata δεν αποκρίθηκε. Οι ' + records.length + ' καταχωρίσεις διαβάζονται από το κεντρικό JSON.';
    console.warn('Αποτυχία φόρτωσης Wikidata.', error);
  }
})();

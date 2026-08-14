'use strict';
/* ============================================================
   Trem de Notícias — lógica do app (vanilla JS, sem build step)
   ============================================================ */

const DATA_URL = 'data/news.json';
const STORAGE_KEYS = {
  theme: 'tn_theme',
  favorites: 'tn_favorites',
  saved: 'tn_saved',
  history: 'tn_history',
  blockedSources: 'tn_blocked_sources',
  biasFilter: 'tn_bias_filter',       // 0 baixo, 1 moderado, 2 alto
  labelOpinion: 'tn_label_opinion',
  priorityLocal: 'tn_priority_local',
  notifUrgent: 'tn_notif_urgent',
  extraCities: 'tn_extra_cities',
  region: 'tn_last_region',
  category: 'tn_last_category'
};

const REGION_ORDER = ['todas', 'claudio', 'regiao_claudio', 'minas', 'brasil', 'mundo'];
const REGION_LABELS = {
  todas: 'Todas', claudio: 'Cláudio', regiao_claudio: 'Região', minas: 'Minas Gerais',
  brasil: 'Brasil', mundo: 'Mundo'
};
const CATEGORY_LABELS = {
  'festas-e-eventos': 'Festas e eventos', 'acontecimentos': 'Acontecimentos',
  'crimes-e-seguranca': 'Crimes e segurança', 'politica': 'Política', 'economia': 'Economia',
  'esportes': 'Esportes', 'cultura': 'Cultura', 'novidades': 'Novidades',
  'tecnologia': 'Tecnologia', 'saude': 'Saúde', 'educacao': 'Educação',
  'utilidade-publica': 'Utilidade pública'
};

let state = {
  data: null,
  region: localStorage.getItem(STORAGE_KEYS.region) || 'todas',
  category: localStorage.getItem(STORAGE_KEYS.category) || 'todas',
  query: '',
  currentItemId: null
};

/* ---------------- Storage helpers ---------------- */
function getJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (_) { return fallback; }
}
function setJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function getFavorites() { return getJSON(STORAGE_KEYS.favorites, []); }
function getSaved() { return getJSON(STORAGE_KEYS.saved, []); }
function getHistory() { return getJSON(STORAGE_KEYS.history, []); }
function getBlockedSources() { return getJSON(STORAGE_KEYS.blockedSources, []); }
function getExtraCities() { return getJSON(STORAGE_KEYS.extraCities, []); }

function toggleInList(key, id, max) {
  const list = getJSON(key, []);
  const idx = list.indexOf(id);
  if (idx >= 0) list.splice(idx, 1); else {
    list.unshift(id);
    if (max) list.splice(max);
  }
  setJSON(key, list);
  return idx < 0;
}

/* ---------------- Theme ---------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('darkSwitch').checked = theme === 'dark';
}
function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);
}
document.getElementById('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem(STORAGE_KEYS.theme, next);
  applyTheme(next);
});
document.getElementById('darkSwitch').addEventListener('change', (e) => {
  const next = e.target.checked ? 'dark' : 'light';
  localStorage.setItem(STORAGE_KEYS.theme, next);
  applyTheme(next);
});

/* ---------------- Online/offline ---------------- */
function updateOnlineStatus() {
  const online = navigator.onLine;
  const pill = document.getElementById('statusPill');
  const text = document.getElementById('statusText');
  const banner = document.getElementById('offlineBanner');
  pill.className = 'status-pill ' + (online ? 'online' : 'offline');
  text.textContent = online ? 'Online' : 'Offline';
  banner.classList.toggle('show', !online);
}
window.addEventListener('online', () => { updateOnlineStatus(); loadData(true); });
window.addEventListener('offline', updateOnlineStatus);

/* ---------------- Data loading ---------------- */
async function loadData(isRefresh) {
  const btn = document.getElementById('refreshBtn');
  if (isRefresh) btn.classList.add('spinning');
  try {
    const res = await fetch(DATA_URL, { cache: isRefresh ? 'reload' : 'default' });
    const json = await res.json();
    state.data = json;
    renderAll();
    checkUrgentNotifications(json.items);
  } catch (e) {
    if (!state.data) {
      document.getElementById('lastUpdateText').textContent =
        'Não foi possível carregar notícias (sem conexão e sem cache local ainda).';
    }
  } finally {
    if (isRefresh) btn.classList.remove('spinning');
  }
}

function formatRelativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function formatUpdateLine(json) {
  if (!json) return '';
  const dt = new Date(json.generatedAt);
  const time = dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const seedNote = json.isSeedData ? ' · dados de exemplo (aguardando 1ª coleta automática)' : '';
  return `Atualizado ${time}${seedNote}`;
}

/* ---------------- Region boost: detect neighboring city mentions ---------------- */
function citiesList() {
  const base = (state.data && state.data.regionsConfig && state.data.regionsConfig.regiao_claudio &&
    state.data.regionsConfig.regiao_claudio.cities) || [];
  return [...new Set([...base, ...getExtraCities()])];
}
function mentionsLocalCity(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  return citiesList().some(c => text.includes(c.toLowerCase()));
}

/* ---------------- Filtering ---------------- */
function biasFilterLevel() { return Number(localStorage.getItem(STORAGE_KEYS.biasFilter) ?? 1); }
function labelOpinionEnabled() { return localStorage.getItem(STORAGE_KEYS.labelOpinion) !== 'false'; }
function priorityLocalEnabled() { return localStorage.getItem(STORAGE_KEYS.priorityLocal) !== 'false'; }

function passesEditorialFilter(item) {
  const level = biasFilterLevel();
  if (level === 0) return true;
  if (level === 1) return true; // moderado: não esconde, só reordena/rebaixa (feito na ordenação)
  // nível alto: esconde opinião/coluna/editorial
  return item.contentType === 'noticia' || item.contentType === 'informe';
}

function priorityRank(item) {
  const p = { critical: 0, high: 1, normal: 2 }[item.priority] ?? 2;
  return p;
}

function getFilteredItems() {
  if (!state.data) return [];
  const blocked = new Set(getBlockedSources());
  const q = state.query.trim().toLowerCase();

  let items = state.data.items.filter(it => {
    if (blocked.has(it.sourceId)) return false;
    if (!passesEditorialFilter(it)) return false;

    if (state.region !== 'todas') {
      const localMatch = mentionsLocalCity(it);
      const matchesRegion =
        it.region === state.region ||
        (state.region === 'regiao_claudio' && (it.region === 'claudio' || localMatch)) ||
        (state.region === 'claudio' && it.region === 'claudio');
      if (!matchesRegion) return false;
    }
    if (state.category !== 'todas' && it.category !== state.category) return false;

    if (q) {
      const hay = `${it.title} ${it.summary} ${it.source} ${it.region}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  items.sort((a, b) => {
    if (priorityLocalEnabled()) {
      const aLocal = (a.region === 'claudio' || a.region === 'regiao_claudio' || mentionsLocalCity(a)) ? 1 : 0;
      const bLocal = (b.region === 'claudio' || b.region === 'regiao_claudio' || mentionsLocalCity(b)) ? 1 : 0;
      if (aLocal !== bLocal) return bLocal - aLocal;
    }
    if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
    if (state.category === 'esportes' || (state.category === 'todas' && a.category === 'esportes' && b.category === 'esportes')) {
      const pr = priorityRank(a) - priorityRank(b);
      if (pr !== 0) return pr;
    }
    if (biasFilterLevel() === 1) {
      const aOp = a.contentType !== 'noticia' ? 1 : 0;
      const bOp = b.contentType !== 'noticia' ? 1 : 0;
      if (aOp !== bOp) return aOp - bOp; // notícia factual sobe
    }
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  return items;
}

/* ---------------- Rendering ---------------- */
function badgesFor(item) {
  const badges = [];
  if (item.isUrgent) badges.push(`<span class="badge badge-urgent">Urgente</span>`);
  if (labelOpinionEnabled() && item.contentType !== 'noticia') {
    const label = { opiniao: 'Opinião', coluna: 'Coluna', editorial: 'Editorial', informe: 'Informe' }[item.contentType] || item.contentType;
    badges.push(`<span class="badge badge-opiniao">${label}</span>`);
  }
  if (item.neutralityScore >= 75 && item.contentType === 'noticia') {
    badges.push(`<span class="badge badge-neutral">Alta neutralidade</span>`);
  }
  const regionLabel = REGION_LABELS[item.region] || item.region;
  badges.push(`<span class="badge badge-region">${regionLabel}</span>`);
  return badges.join('');
}

function thumbHtml(item) {
  if (item.image) {
    return `<div class="thumb"><img src="${item.image}" alt="" loading="lazy" onerror="this.parentElement.classList.add('no-image');this.remove();"></div>`;
  }
  return `<div class="thumb no-image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 13h3"/></svg></div>`;
}

function cardHtml(item, isFav, isSaved) {
  return `
  <article class="news-card" data-id="${item.id}">
    ${thumbHtml(item)}
    <div class="body">
      <div class="badges">${badgesFor(item)}</div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="summary">${escapeHtml(item.summary)}</p>
      <div class="meta">
        <span>${escapeHtml(item.source)}</span> · <span>${formatRelativeTime(item.publishedAt)}</span>
      </div>
      ${item.alsoReportedBy && item.alsoReportedBy.length ? `<div class="also-reported">Também noticiado por ${item.alsoReportedBy.length} outra(s) fonte(s)</div>` : ''}
    </div>
    <div class="card-actions">
      <button class="fav-btn ${isFav ? 'active' : ''}" data-id="${item.id}" aria-label="Favoritar">
        <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="m12 21-1.5-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.5 11.2L12 21Z"/></svg>
      </button>
      <button class="save-btn ${isSaved ? 'active' : ''}" data-id="${item.id}" aria-label="Salvar para ler depois">
        <svg viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>
      </button>
    </div>
  </article>`;
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function renderFeed() {
  const items = getFilteredItems();
  const favorites = getFavorites();
  const saved = getSaved();
  const heroSlot = document.getElementById('heroSlot');
  const feedList = document.getElementById('feedList');
  const empty = document.getElementById('emptyState');

  document.getElementById('lastUpdateText').textContent = formatUpdateLine(state.data);

  if (!items.length) {
    heroSlot.innerHTML = '';
    feedList.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const [hero, ...rest] = items;
  heroSlot.innerHTML = `
    <div class="hero-card" data-id="${hero.id}">
      ${hero.image ? `<img src="${hero.image}" alt="" loading="lazy" onerror="this.remove()">` : `<div class="hero-fallback"></div>`}
      <div class="hero-body">
        <div class="badges">${badgesFor(hero)}</div>
        <h2>${escapeHtml(hero.title)}</h2>
        <div class="meta">${escapeHtml(hero.source)} · ${formatRelativeTime(hero.publishedAt)}</div>
      </div>
    </div>`;

  feedList.innerHTML = rest.map(it => cardHtml(it, favorites.includes(it.id), saved.includes(it.id))).join('');

  attachCardHandlers(document.getElementById('viewFeed'));
}

function renderSavedAndFavorites() {
  if (!state.data) return;
  const byId = new Map(state.data.items.map(it => [it.id, it]));
  const favorites = getFavorites().map(id => byId.get(id)).filter(Boolean);
  const saved = getSaved().map(id => byId.get(id)).filter(Boolean);

  document.getElementById('savedList').innerHTML = saved.length
    ? saved.map(it => cardHtml(it, favorites.some(f => f.id === it.id), true)).join('')
    : `<p style="color:var(--ink-soft); font-size:.88rem;">Nada salvo ainda. Toque no ícone de marcador em qualquer notícia.</p>`;

  document.getElementById('favoritesList').innerHTML = favorites.length
    ? favorites.map(it => cardHtml(it, true, saved.some(s => s.id === it.id))).join('')
    : `<p style="color:var(--ink-soft); font-size:.88rem;">Nenhum favorito ainda. Toque no coração em qualquer notícia.</p>`;

  attachCardHandlers(document.getElementById('viewSaved'));
}

function renderHistory() {
  if (!state.data) return;
  const byId = new Map(state.data.items.map(it => [it.id, it]));
  const history = getHistory().map(id => byId.get(id)).filter(Boolean);
  document.getElementById('historyList').innerHTML = history.length
    ? history.map(it => cardHtml(it, getFavorites().includes(it.id), getSaved().includes(it.id))).join('')
    : `<p style="color:var(--ink-soft); font-size:.88rem;">Você ainda não abriu nenhuma notícia.</p>`;
  attachCardHandlers(document.getElementById('viewHistory'));
}

function attachCardHandlers(scope) {
  scope.querySelectorAll('.news-card, .hero-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-actions')) return;
      openReader(card.dataset.id);
    });
  });
  scope.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInList(STORAGE_KEYS.favorites, btn.dataset.id, 500);
      renderAll();
    });
  });
  scope.querySelectorAll('.save-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInList(STORAGE_KEYS.saved, btn.dataset.id, 500);
      renderAll();
    });
  });
}

/* ---------------- Reader sheet ---------------- */
function openReader(id) {
  const item = state.data.items.find(it => it.id === id);
  if (!item) return;
  state.currentItemId = id;

  const history = getJSON(STORAGE_KEYS.history, []).filter(x => x !== id);
  history.unshift(id);
  setJSON(STORAGE_KEYS.history, history.slice(0, 300));

  const opinionNote = item.contentType !== 'noticia'
    ? `<div class="editorial-box"><strong>Conteúdo classificado como ${({opiniao:'opinião',coluna:'coluna',editorial:'editorial',informe:'informe'}[item.contentType] || item.contentType)}.</strong> Textos assim podem trazer interpretação ou posicionamento do autor, e não somente fatos apurados.</div>`
    : `<div class="editorial-box"><strong>Índice de neutralidade estimado: ${item.neutralityScore}/100.</strong> Confiabilidade da fonte: ${item.reliabilityScore}/100. Classificação automática baseada em linguagem, presença de dados verificáveis e histórico da fonte — não substitui a leitura crítica.</div>`;

  document.getElementById('readerContent').innerHTML = `
    ${item.image ? `<img class="thumb-large" src="${item.image}" alt="" onerror="this.remove()">` : ''}
    <div class="badges">${badgesFor(item)}</div>
    <h2>${escapeHtml(item.title)}</h2>
    <div class="meta-line">${escapeHtml(item.source)} · ${new Date(item.publishedAt).toLocaleString('pt-BR')}</div>
    <p class="summary-full">${escapeHtml(item.summary) || 'Resumo não disponível para esta notícia.'}</p>
    ${item.alsoReportedBy && item.alsoReportedBy.length ? `<p class="summary-full" style="font-size:.82rem;color:var(--ink-soft)">Também noticiado por: ${item.alsoReportedBy.map(escapeHtml).join(', ')}</p>` : ''}
    ${opinionNote}
    <div class="sheet-actions">
      <a class="primary" href="${item.link}" target="_blank" rel="noopener">Ler matéria completa</a>
      <button id="shareBtn">Compartilhar</button>
    </div>
  `;
  document.getElementById('shareBtn').addEventListener('click', () => shareItem(item));
  document.getElementById('sheetBackdrop').classList.add('open');
  document.getElementById('readerSheet').classList.add('open');
}
function closeReader() {
  document.getElementById('sheetBackdrop').classList.remove('open');
  document.getElementById('readerSheet').classList.remove('open');
}
document.getElementById('sheetBackdrop').addEventListener('click', closeReader);
document.getElementById('sheetCloseBtn').addEventListener('click', closeReader);

function shareItem(item) {
  if (navigator.share) {
    navigator.share({ title: item.title, text: item.summary, url: item.link }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(item.link);
    alert('Link copiado!');
  }
}

/* ---------------- Notifications ---------------- */
function checkUrgentNotifications(items) {
  if (localStorage.getItem(STORAGE_KEYS.notifUrgent) !== 'true') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const seen = getJSON('tn_notified_urgent', []);
  const urgent = items.filter(it => it.isUrgent && !seen.includes(it.id)).slice(0, 3);
  urgent.forEach(it => {
    new Notification('Trem de Notícias — Urgente', { body: it.title, tag: it.id });
    seen.push(it.id);
  });
  setJSON('tn_notified_urgent', seen.slice(-200));
}

/* ---------------- Nav / tabs ---------------- */
function goToFeedTab() {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="viewFeed"]').classList.add('active');
  ['viewFeed', 'viewSaved', 'viewHistory', 'viewSettings'].forEach(id => {
    document.getElementById(id).style.display = id === 'viewFeed' ? 'block' : 'none';
  });
}

function buildLinesNav() {
  const nav = document.getElementById('linesNav');
  nav.innerHTML = REGION_ORDER.map(r => `
    <button class="line-tab ${state.region === r ? 'active' : ''}" data-region="${r}">
      <span class="dot"></span>${REGION_LABELS[r]}
    </button>`).join('');
  nav.querySelectorAll('.line-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.region = btn.dataset.region;
      localStorage.setItem(STORAGE_KEYS.region, state.region);
      goToFeedTab();
      buildLinesNav();
      renderFeed();
    });
  });
}

function buildCategoryRow() {
  const row = document.getElementById('categoryRow');
  const cats = ['todas', ...Object.keys(CATEGORY_LABELS)];
  row.innerHTML = cats.map(c => `
    <button class="chip ${state.category === c ? 'active' : ''}" data-cat="${c}">
      ${c === 'todas' ? 'Todas' : CATEGORY_LABELS[c]}
    </button>`).join('');
  row.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.category = btn.dataset.cat;
      localStorage.setItem(STORAGE_KEYS.category, state.category);
      goToFeedTab();
      buildCategoryRow();
      renderFeed();
    });
  });
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderFeed();
});
document.getElementById('refreshBtn').addEventListener('click', () => loadData(true));

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    closeReader();
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['viewFeed', 'viewSaved', 'viewHistory', 'viewSettings'].forEach(id => {
      document.getElementById(id).style.display = id === btn.dataset.view ? 'block' : 'none';
    });
    renderAll();
  });
});

/* ---------------- Settings screen ---------------- */
function initSettings() {
  const bias = biasFilterLevel();
  const biasRange = document.getElementById('biasFilterRange');
  const biasLabel = document.getElementById('biasFilterValue');
  const labels = ['Baixo', 'Moderado', 'Alto'];
  biasRange.value = bias;
  biasLabel.textContent = labels[bias];
  biasRange.addEventListener('input', () => {
    localStorage.setItem(STORAGE_KEYS.biasFilter, biasRange.value);
    biasLabel.textContent = labels[Number(biasRange.value)];
    renderAll();
  });

  document.getElementById('labelSwitch').checked = labelOpinionEnabled();
  document.getElementById('labelSwitch').addEventListener('change', (e) => {
    localStorage.setItem(STORAGE_KEYS.labelOpinion, e.target.checked);
    renderAll();
  });

  document.getElementById('prioritySwitch').checked = priorityLocalEnabled();
  document.getElementById('prioritySwitch').addEventListener('change', (e) => {
    localStorage.setItem(STORAGE_KEYS.priorityLocal, e.target.checked);
    renderAll();
  });

  const notifSwitch = document.getElementById('notifSwitch');
  notifSwitch.checked = localStorage.getItem(STORAGE_KEYS.notifUrgent) === 'true';
  notifSwitch.addEventListener('change', async (e) => {
    if (e.target.checked && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { e.target.checked = false; return; }
    }
    localStorage.setItem(STORAGE_KEYS.notifUrgent, e.target.checked);
  });

  renderCityTags();
  document.getElementById('addCityBtn').addEventListener('click', addCity);
  document.getElementById('newCityInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addCity(); });

  document.getElementById('aboutText').innerHTML =
    'Trem de Notícias agrega automaticamente fontes públicas de RSS e páginas noticiosas, com foco em Brasil, Mundo, Minas Gerais e Cláudio-MG. ' +
    'A coleta roda periodicamente via GitHub Actions; este app funciona offline com o último conteúdo sincronizado.';
}

function renderCityTags() {
  const wrap = document.getElementById('cityTags');
  wrap.innerHTML = citiesList().map(c => `
    <span class="city-tag">${escapeHtml(c)}
      <button data-city="${escapeHtml(c)}" aria-label="Remover">×</button>
    </span>`).join('');
  wrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const extra = getExtraCities().filter(c => c !== btn.dataset.city);
      setJSON(STORAGE_KEYS.extraCities, extra);
      // se era uma cidade base (não estava em extra), guarda como "removida" localmente não é suportado sem lista de exclusão;
      // então simplesmente ignoramos remoção de cidades-base vindas do sources.json.
      renderCityTags();
      renderAll();
    });
  });
}
function addCity() {
  const input = document.getElementById('newCityInput');
  const val = input.value.trim();
  if (!val) return;
  const extra = getExtraCities();
  if (!extra.includes(val)) { extra.push(val); setJSON(STORAGE_KEYS.extraCities, extra); }
  input.value = '';
  renderCityTags();
  renderAll();
}

function renderSourceList() {
  if (!state.data) return;
  const list = document.getElementById('sourceList');
  const bySource = new Map();
  state.data.items.forEach(it => {
    if (!bySource.has(it.sourceId)) bySource.set(it.sourceId, { name: it.source, region: it.region, count: 0 });
    bySource.get(it.sourceId).count++;
  });
  const blocked = new Set(getBlockedSources());
  list.innerHTML = [...bySource.entries()].map(([id, info]) => `
    <div class="source-row">
      <div class="name">${escapeHtml(info.name)}<div class="tag">${REGION_LABELS[info.region] || info.region} · ${info.count} notícia(s) em cache</div></div>
      <label class="switch"><input type="checkbox" data-source="${id}" ${blocked.has(id) ? '' : 'checked'}><span class="track"></span></label>
    </div>`).join('') || `<p style="color:var(--ink-soft);font-size:.85rem">Nenhuma fonte carregada ainda.</p>`;

  list.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', (e) => {
      let blocked = getBlockedSources();
      const id = e.target.dataset.source;
      if (e.target.checked) blocked = blocked.filter(b => b !== id);
      else if (!blocked.includes(id)) blocked.push(id);
      setJSON(STORAGE_KEYS.blockedSources, blocked);
      renderAll();
    });
  });
}

/* ---------------- Master render ---------------- */
function renderAll() {
  if (!state.data) return;
  buildLinesNav();
  buildCategoryRow();
  renderFeed();
  renderSavedAndFavorites();
  renderHistory();
  renderSourceList();
}

/* ---------------- Init ---------------- */
initTheme();
initSettings();
updateOnlineStatus();
loadData(false);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// Sincroniza automaticamente ao reabrir o app (respeitando cache do SW)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadData(false);
});

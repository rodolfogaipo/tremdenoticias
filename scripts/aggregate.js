'use strict';
/**
 * Trem de Notícias — coletor automático.
 * Lê scripts/sources.json, busca cada fonte (RSS ou HTML/OpenGraph),
 * normaliza, remove duplicadas, classifica editorialmente e grava
 * docs/data/news.json (consumido pelo app / service worker).
 *
 * Uso:  node aggregate.js
 * Executado automaticamente pelo GitHub Actions (.github/workflows/aggregate.yml)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Parser = require('rss-parser');
const cheerio = require('cheerio');

const { scoreItem, normalize } = require('./classifier.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCES_PATH = path.join(__dirname, 'sources.json');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'data', 'news.json');
const MAX_AGE_DAYS = 12;
const HTML_MAX_LINKS = 12;
const FETCH_TIMEOUT_MS = 15000;
const SUMMARY_MAX_LEN = 600;

const rssParser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { 'User-Agent': 'TremDeNoticiasBot/1.0 (+agregador de RSS publico)' }
});

function log(...args) { console.log('[aggregate]', ...args); }
function warn(...args) { console.warn('[aggregate][aviso]', ...args); }

function hashId(str) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 16);
}

function stripHtml(html) {
  if (!html) return '';
  return cheerio.load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

function smartTruncate(text, maxLen) {
  const clean = (text || '').trim();
  if (clean.length <= maxLen) return clean;
  const slice = clean.slice(0, maxLen);
  const lastSentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (lastSentenceEnd > maxLen * 0.4) {
    return slice.slice(0, lastSentenceEnd + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim() + '…';
}

function normalizeTitleKey(title) {
  return normalize(title)
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .sort()
    .join(' ');
}

function jaccardSimilarity(a, b) {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = new Set([...setA, ...setB]).size;
  return inter / union;
}

async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

function extractFirstImageFromHtml(html, baseUrl) {
  if (!html) return null;
  try {
    const $ = cheerio.load(html);
    const img = $('img').first().attr('src') || $('img').first().attr('data-src');
    if (!img) return null;
    return baseUrl ? new URL(img, baseUrl).toString() : img;
  } catch (_) {
    return null;
  }
}

async function fetchRss(source) {
  const feed = await withTimeout(rssParser.parseURL(source.url), FETCH_TIMEOUT_MS);
  const items = [];
  for (const entry of feed.items || []) {
    const title = (entry.title || '').trim();
    if (!title) continue;
    const rawContentHtml = entry['content:encoded'] || entry.content || entry.summary || '';
    const summary = stripHtml(entry.contentSnippet || rawContentHtml);
    const link = entry.link || entry.guid || '';

    let image =
      (entry.enclosure && entry.enclosure.url) ||
      (entry['media:content'] && entry['media:content'].$ && entry['media:content'].$.url) ||
      (entry['media:thumbnail'] && entry['media:thumbnail'].$ && entry['media:thumbnail'].$.url) ||
      null;
    if (!image) image = extractFirstImageFromHtml(rawContentHtml, link);

    const publishedAt = entry.isoDate || entry.pubDate || new Date().toISOString();
    items.push({
      title,
      summary: smartTruncate(summary, SUMMARY_MAX_LEN),
      link,
      image,
      publishedAt,
      dateIsReal: true,
      sectionHint: (entry.categories || []).join(' ')
    });
  }
  return items;
}

async function fetchHtml(source) {
  const res = await withTimeout(fetch(source.url, {
    headers: { 'User-Agent': 'TremDeNoticiasBot/1.0 (+agregador de conteudo publico)' }
  }), FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const base = new URL(source.url);

  const links = new Set();
  $('a[href]').each((_, el) => {
    let href = $(el).attr('href');
    if (!href) return;
    const anchorText = $(el).text().replace(/\s+/g, ' ').trim();
    if (anchorText.split(' ').length < 5 || anchorText.length < 25) return;
    try {
      const abs = new URL(href, base).toString();
      const u = new URL(abs);
      if (u.hostname !== base.hostname) return;
      if (/\.(jpg|jpeg|png|gif|pdf|css|js)$/i.test(u.pathname)) return;
      if (u.pathname === '/' || u.pathname.length < 12) return;
      const lastSegment = u.pathname.split('/').filter(Boolean).pop() || '';
      if (/^\d{4}$/.test(lastSegment)) return;
      if (/(^|[?&])(ano|year|page|pagina)=/i.test(u.search)) return;
      if (/\/(tag|tags|categoria|category|arquivo|archive|page|pagina)\//i.test(u.pathname)) return;
      if (/(regimento|transparencia|licitac|legislac|servidor|ouvidoria|contato|institucional|estrutura|comiss|estatuto|sobre-a|historia)/i.test(u.pathname)) return;
      if (/(nua|nudez|pelada|sensual|erotic|onlyfans|adulto|boquete|sexo|nsfw|hot-|-hot\b)/i.test(u.pathname + ' ' + anchorText.toLowerCase())) return;
      links.add(abs.split('#')[0]);
    } catch (_) { /* ignore invalid urls */ }
  });

  const candidates = [...links].slice(0, HTML_MAX_LINKS);
  const items = [];
  for (const url of candidates) {
    try {
      const r = await withTimeout(fetch(url, {
        headers: { 'User-Agent': 'TremDeNoticiasBot/1.0 (+agregador de conteudo publico)' }
      }), FETCH_TIMEOUT_MS);
      if (!r.ok) continue;
      const pageHtml = await r.text();
      const $$ = cheerio.load(pageHtml);

      const title = ($$('meta[property="og:title"]').attr('content') || $$('title').text() || '').trim();

      if (!title || /^\d{1,4}$/.test(title)) continue;
      if (/(nua|nudez|pelada|sensual|erotic|onlyfans|boquete|nsfw)/i.test(title.toLowerCase())) continue;

      const NAV_BOILERPLATE = /ir para o (conte[uú]do|menu|busca|rodap[eé])|pular para|acessibilidade/i;

      let summary = $$('meta[property="og:description"]').attr('content') ||
                     $$('meta[name="description"]').attr('content') || '';
      if (summary && NAV_BOILERPLATE.test(summary)) summary = '';
      if (!summary || summary.length < 60) {
        const firstParagraph = $$('article p, .content p, .post-content p, .entry-content p, p')
          .filter((_, el) => {
            const t = $$(el).text().trim();
            return t.length > 60 && !NAV_BOILERPLATE.test(t);
          })
          .first().text().trim();
        if (firstParagraph) summary = firstParagraph;
      }
      if (!summary || NAV_BOILERPLATE.test(summary)) continue;

      const image =
        $$('meta[property="og:image"]').attr('content') ||
        $$('meta[name="twitter:image"]').attr('content') ||
        extractFirstImageFromHtml($$('article').html() || pageHtml, url) ||
        null;

      const explicitDate =
        $$('meta[property="article:published_time"]').attr('content') ||
        $$('meta[itemprop="datePublished"]').attr('content') ||
        $$('time[datetime]').first().attr('datetime') ||
        $$('meta[name="date"]').attr('content') ||
        null;

      items.push({
        title,
        summary: smartTruncate(summary, SUMMARY_MAX_LEN),
        link: url,
        image,
        publishedAt: explicitDate || new Date().toISOString(),
        dateIsReal: Boolean(explicitDate),
        sectionHint: ''
      });
    } catch (e) {
      // ignora páginas individuais que falharem
    }
  }
  return items;
}

async function collectFromSource(source) {
  try {
    const raw = source.type === 'html' ? await fetchHtml(source) : await fetchRss(source);
    log(`${source.name}: ${raw.length} itens brutos`);
    return raw.map(r => ({ ...r, source }));
  } catch (e) {
    warn(`${source.name} falhou (${source.url}): ${e.message}`);
    return [];
  }
}

function buildItem(raw) {
  const { source } = raw;
  const classification = scoreItem({
    title: raw.title,
    summary: raw.summary,
    sectionHint: raw.sectionHint,
    feedCategory: source.category_default,
    sourceTrust: source.trust_score,
    sourceOpinionBias: source.opinion_bias
  });

  return {
    id: hashId(raw.link || raw.title + source.id),
    title: raw.title,
    summary: raw.summary,
    link: raw.link,
    image: raw.image || null,
    publishedAt: new Date(raw.publishedAt).toISOString(),
    dateIsReal: Boolean(raw.dateIsReal),
    collectedAt: new Date().toISOString(),
    source: source.name,
    sourceId: source.id,
    region: source.region,
    category: source.category_default,
    priority: source.priority || 'normal',
    ...classification,
    alsoReportedBy: []
  };
}

function stabilizeDates(freshItems, previousItems) {
  const previousById = new Map(previousItems.map(it => [it.id, it]));
  return freshItems.map(item => {
    if (item.dateIsReal) return item;
    const prev = previousById.get(item.id);
    if (prev) {
      return { ...item, publishedAt: prev.publishedAt };
    }
    return item;
  });
}

function dedupe(items) {
  const byId = new Map();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else {
      const keep = item.collectedAt > existing.collectedAt ? item : existing;
      const other = keep === item ? existing : item;
      keep.alsoReportedBy = [...new Set([...(keep.alsoReportedBy || []), ...(other.alsoReportedBy || [])])];
      byId.set(item.id, keep);
    }
  }
  const uniqueById = [...byId.values()];

  const sorted = uniqueById.sort((a, b) => b.reliabilityScore - a.reliabilityScore);
  const kept = [];
  const keys = sorted.map(it => normalizeTitleKey(it.title));

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const key = keys[i];
    let mergedInto = null;

    for (const existing of kept) {
      const existingKey = normalizeTitleKey(existing.title);
      const sameDay = existing.publishedAt.slice(0, 10) === item.publishedAt.slice(0, 10);
      if (!sameDay) continue;
      if (existingKey === key || jaccardSimilarity(existingKey, key) >= 0.62) {
        mergedInto = existing;
        break;
      }
    }

    if (mergedInto) {
      if (!mergedInto.alsoReportedBy.includes(item.source) && item.source !== mergedInto.source) {
        mergedInto.alsoReportedBy.push(item.source);
      }
    } else {
      kept.push(item);
    }
  }
  return kept;
}

function loadPrevious() {
  try {
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.items) ? data.items : [];
  } catch (_) {
    return [];
  }
}

function pruneOld(items) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return items.filter(it => new Date(it.publishedAt).getTime() >= cutoff);
}

async function main() {
  const config = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf-8'));
  const activeSources = config.sources.filter(s => s.active);
  log(`Coletando de ${activeSources.length} fontes ativas...`);

  const results = await Promise.all(activeSources.map(collectFromSource));
  const rawItems = results.flat();
  const freshItemsRaw = rawItems.map(buildItem);

  const previous = loadPrevious();
  const freshItems = stabilizeDates(freshItemsRaw, previous);

  const combined = dedupe([...freshItems, ...previous]);
  const finalItems = pruneOld(combined).sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  const output = {
    generatedAt: new Date().toISOString(),
    regionsConfig: config.regions,
    categories: config.categories,
    sourceCount: activeSources.length,
    itemCount: finalItems.length,
    items: finalItems
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`Gravado ${OUTPUT_PATH} com ${finalItems.length} notícias (de ${rawItems.length} brutas).`);
}

main().catch(err => {
  console.error('[aggregate] erro fatal:', err);
  process.exit(1);
});

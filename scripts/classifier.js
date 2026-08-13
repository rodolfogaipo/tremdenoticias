'use strict';
/**
 * Classificador editorial simples, baseado em regras (heurísticas de texto).
 * Não substitui um modelo de linguagem, mas dá uma pontuação consistente e
 * auditável de "quão factual x opinativo" um título/resumo parece ser.
 *
 * Critérios (conforme briefing):
 *  - linguagem objetiva x carregada
 *  - presença de dados verificáveis (números, datas, citações "disse", "segundo")
 *  - presença de fonte primária / oficial
 *  - sensacionalismo (caixa alta, excesso de pontuação, clickbait)
 *  - marcadores de opinião/coluna/editorial
 */

const OPINION_MARKERS = [
  'na minha opinião', 'eu acho', 'acredito que', 'é um absurdo', 'é uma vergonha',
  'lamentável', 'inaceitável', 'covardia', 'traição', 'é óbvio que', 'convenhamos',
  'não é novidade', 'como era de se esperar', 'analisa', 'análise:', 'coluna:',
  'opinião:', 'editorial:', 'ponto de vista', 'na prática, o que vemos',
  'é hora de', 'precisamos falar sobre', 'a verdade é que'
];

const SECTION_OPINION_TAGS = [
  'opiniao', 'opinião', 'coluna', 'colunista', 'editorial', 'blog', 'analise', 'análise'
];

const SENSATIONALIST_MARKERS = [
  'urgente', 'chocante', 'bombástico', 'ninguém esperava', 'você não vai acreditar',
  'revoltante', 'absurdo', 'inacreditável', 'atenção:', 'alerta:', 'exclusivo:',
  'saiba o motivo', 'entenda o motivo', 'olha só', 'assista'
];

const FACTUAL_MARKERS = [
  'segundo', 'de acordo com', 'afirmou', 'declarou', 'informou', 'confirmou',
  'em nota', 'nota oficial', 'divulgou', 'dados do', 'pesquisa do', 'levantamento',
  'ministério', 'secretaria', 'prefeitura', 'polícia civil', 'polícia militar',
  'boletim de ocorrência', 'processo nº', 'lei nº', 'decreto nº'
];

const URGENT_MARKERS = ['urgente', 'última hora', 'de última hora', 'breaking news', 'boletim urgente'];

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function countHits(text, markers) {
  const t = normalize(text);
  let hits = 0;
  for (const m of markers) {
    if (t.includes(normalize(m))) hits++;
  }
  return hits;
}

function capsRatio(title) {
  const letters = (title || '').replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (!letters.length) return 0;
  const caps = letters.replace(/[^A-ZÀ-Þ]/g, '');
  return caps.length / letters.length;
}

function punctuationSpikes(title) {
  const exclam = (title.match(/!/g) || []).length;
  const question = (title.match(/\?/g) || []).length;
  return exclam >= 2 || (exclam >= 1 && question >= 1) || question >= 2;
}

/**
 * Detecta o "tipo de conteúdo": noticia | opiniao | coluna | editorial | informe
 */
function detectContentType({ title, summary, sectionHint, feedCategory }) {
  const hay = normalize(`${sectionHint || ''} ${feedCategory || ''}`);
  for (const tag of SECTION_OPINION_TAGS) {
    if (hay.includes(tag)) {
      if (hay.includes('editorial')) return 'editorial';
      if (hay.includes('coluna') || hay.includes('colunista')) return 'coluna';
      return 'opiniao';
    }
  }
  const text = `${title} ${summary}`;
  const opinionHits = countHits(text, OPINION_MARKERS);
  if (opinionHits >= 2) return 'opiniao';

  const hayText = normalize(text);
  if (hayText.includes('comunicado') || hayText.includes('nota oficial') || hayText.includes('edital')) {
    return 'informe';
  }
  return 'noticia';
}

/**
 * Retorna um objeto de pontuação editorial de 0-100 em cada eixo.
 * neutrality: 100 = muito factual/neutro, 0 = muito opinativo/carregado.
 */
function scoreItem({ title, summary, sectionHint, feedCategory, sourceTrust = 50, sourceOpinionBias = 20 }) {
  const text = `${title} ${summary}`;
  const contentType = detectContentType({ title, summary, sectionHint, feedCategory });

  const opinionHits = countHits(text, OPINION_MARKERS);
  const sensationalistHits = countHits(text, SENSATIONALIST_MARKERS);
  const factualHits = countHits(text, FACTUAL_MARKERS);
  const caps = capsRatio(title);
  const punchy = punctuationSpikes(title || '');
  const isUrgent = countHits(text, URGENT_MARKERS) > 0;

  let sensationalism = 0;
  sensationalism += sensationalistHits * 18;
  sensationalism += caps > 0.4 ? 25 : 0;
  sensationalism += punchy ? 15 : 0;
  sensationalism = Math.min(100, sensationalism);

  let opinionLoad = 0;
  opinionLoad += opinionHits * 20;
  opinionLoad += contentType !== 'noticia' ? 30 : 0;
  opinionLoad += Math.round(sourceOpinionBias * 0.5);
  opinionLoad = Math.min(100, opinionLoad);

  let factualSignal = Math.min(100, factualHits * 15 + (sourceTrust * 0.5));

  // Neutralidade final: pondera opinião (peso maior), sensacionalismo e reforça com sinal factual.
  let neutrality = 100 - (opinionLoad * 0.55 + sensationalism * 0.30);
  neutrality += (factualSignal - 50) * 0.15; // pequeno ajuste pelo lastro factual
  neutrality = Math.max(0, Math.min(100, Math.round(neutrality)));

  const reliabilityScore = Math.round(
    Math.max(0, Math.min(100, sourceTrust * 0.6 + factualSignal * 0.25 + (100 - sensationalism) * 0.15))
  );

  return {
    contentType,          // noticia | opiniao | coluna | editorial | informe
    isOpinionFlagged: contentType !== 'noticia' || opinionLoad >= 55,
    isSensationalist: sensationalism >= 45,
    isUrgent,
    neutralityScore: neutrality,   // 0-100, maior = mais neutro/factual
    reliabilityScore,               // 0-100, confiabilidade combinada da fonte + do texto
    sensationalismScore: sensationalism,
    opinionScore: opinionLoad
  };
}

module.exports = { scoreItem, detectContentType, normalize };

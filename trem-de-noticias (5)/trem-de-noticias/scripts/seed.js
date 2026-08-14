'use strict';
/**
 * Gera docs/data/news.json de EXEMPLO, só para o app não abrir vazio antes da
 * primeira execução do coletor automático (GitHub Actions). Os itens são
 * fictícios/ilustrativos e marcados com "[Exemplo]" — apague assim que o
 * workflow "Coletar notícias automaticamente" rodar pela primeira vez.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scoreItem } = require('./classifier.js');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'data', 'news.json');
const sourcesConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf-8'));

const now = Date.now();
const h = (n) => new Date(now - n * 3600 * 1000).toISOString();

const RAW = [
  { title: '[Exemplo] Prefeitura de Cláudio abre inscrições para curso técnico gratuito', summary: 'Segundo a Secretaria de Educação, as vagas são limitadas e as aulas começam no próximo mês.', region: 'claudio', category: 'educacao', source: 'Portal Cláudio (exemplo)', trust: 55, bias: 15, hours: 2, image: null },
  { title: '[Exemplo] Festa junina reúne moradores no centro de Cláudio neste fim de semana', summary: 'Organização informou programação com quadrilhas, barracas e shows a partir das 18h.', region: 'claudio', category: 'festas-e-eventos', source: 'Portal Cláudio (exemplo)', trust: 55, bias: 15, hours: 5, image: null },
  { title: '[Exemplo] Obra de pavimentação altera trânsito em trecho de Divinópolis', summary: 'De acordo com a prefeitura, desvio ficará ativo por cerca de duas semanas.', region: 'regiao_claudio', category: 'utilidade-publica', source: 'Diário Região (exemplo)', trust: 55, bias: 15, hours: 3, image: null },
  { title: '[Exemplo] Polícia Civil investiga furto em comércio de Itaúna', summary: 'Boletim de ocorrência foi registrado na madrugada desta quinta-feira, segundo a corporação.', region: 'regiao_claudio', category: 'crimes-e-seguranca', source: 'Diário Região (exemplo)', trust: 55, bias: 10, hours: 8, image: null },
  { title: '[Exemplo] Governo de Minas anuncia repasse extra para saúde municipal', summary: 'Recursos serão distribuídos conforme critérios populacionais, segundo nota da Secretaria de Estado de Saúde.', region: 'minas', category: 'saude', source: 'G1 - Minas Gerais (exemplo)', trust: 78, bias: 5, hours: 1, image: null },
  { title: '[Exemplo] Belo Horizonte registra queda na taxa de desemprego no trimestre', summary: 'Dados do IBGE apontam retração em relação ao período anterior.', region: 'minas', category: 'economia', source: 'G1 - Minas Gerais (exemplo)', trust: 78, bias: 5, hours: 6, image: null },
  { title: '[Exemplo] Câmara dos Deputados aprova texto-base de projeto sobre infraestrutura', summary: 'Proposta segue agora para análise do Senado Federal, segundo assessoria da Casa.', region: 'brasil', category: 'politica', source: 'Agência Brasil (exemplo)', trust: 82, bias: 3, hours: 2, image: null },
  { title: '[Exemplo] Banco Central mantém taxa básica de juros inalterada', summary: 'Decisão do Copom foi tomada por unanimidade, de acordo com ata divulgada nesta semana.', region: 'brasil', category: 'economia', source: 'G1 - Economia (exemplo)', trust: 78, bias: 5, hours: 4, image: null },
  { title: '[Exemplo] Seleção brasileira divulga lista de convocados para amistosos', summary: 'Treinador comentou critérios técnicos em coletiva de imprensa, segundo apuração.', region: 'brasil', category: 'esportes', source: 'G1 - Brasil (exemplo)', trust: 80, bias: 5, hours: 10, image: null },
  { title: '[Exemplo] União Europeia discute novas diretrizes sobre inteligência artificial', summary: 'Bloco avalia regras de transparência para empresas de tecnologia, segundo comunicado oficial.', region: 'mundo', category: 'tecnologia', source: 'BBC News Brasil (exemplo)', trust: 85, bias: 5, hours: 3, image: null },
  { title: '[Exemplo] Organização humanitária alerta para crise climática em região da África', summary: 'Relatório aponta aumento de deslocamentos populacionais nos últimos meses.', region: 'mundo', category: 'acontecimentos', source: 'BBC News Brasil (exemplo)', trust: 85, bias: 5, hours: 7, image: null },
  { title: '[Exemplo/Opinião] Coluna: é preciso repensar a mobilidade urbana nas cidades médias', summary: 'Colunista defende investimento em transporte público e critica modelo atual.', region: 'minas', category: 'novidades', source: 'O Tempo - Coluna (exemplo)', trust: 65, bias: 55, hours: 5, image: null, sectionHint: 'coluna opiniao' }
];

const items = RAW.map(r => {
  const classification = scoreItem({
    title: r.title, summary: r.summary, sectionHint: r.sectionHint || '',
    feedCategory: r.category, sourceTrust: r.trust, sourceOpinionBias: r.bias
  });
  return {
    id: crypto.createHash('sha1').update(r.title).digest('hex').slice(0, 16),
    title: r.title,
    summary: r.summary,
    link: '#',
    image: r.image,
    publishedAt: h(r.hours),
    collectedAt: new Date(now).toISOString(),
    source: r.source,
    sourceId: 'seed',
    region: r.region,
    category: r.category,
    priority: 'normal',
    ...classification,
    alsoReportedBy: []
  };
});

items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

const output = {
  generatedAt: new Date(now).toISOString(),
  regionsConfig: sourcesConfig.regions,
  categories: sourcesConfig.categories,
  sourceCount: 0,
  itemCount: items.length,
  isSeedData: true,
  items
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
console.log(`Seed gravado em ${OUTPUT_PATH} (${items.length} itens de exemplo).`);

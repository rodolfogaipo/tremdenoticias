# 🚂 Trem de Notícias

Agregador automático de notícias (PWA, funciona offline) com foco em **Brasil, Mundo, Minas Gerais, Cláudio-MG e região**, e um filtro editorial que tenta reduzir sensacionalismo e opinião disfarçada de notícia.

---

## Como o app funciona, de verdade (leia antes)

Isso aqui **não é um app comum** — ele tem duas partes que rodam em lugares diferentes:

1. **O coletor** (`scripts/aggregate.js`): um programinha Node.js que lê `scripts/sources.json`, busca cada fonte (RSS ou página HTML), organiza, remove duplicadas, classifica editorialmente e grava tudo em `docs/data/news.json`.
2. **O app** (pasta `docs/`): um PWA (site que funciona como aplicativo) que **só lê** esse `news.json`, guarda uma cópia no celular via Service Worker e funciona offline.

**O coletor não roda dentro do navegador do usuário** — a maioria dos sites de notícia bloqueia esse tipo de acesso direto do navegador (política de CORS) e um site estático do GitHub Pages não tem "servidor" para rodar tarefas automáticas sozinho. A solução usada aqui é o **GitHub Actions**: o próprio GitHub roda o coletor de tempos em tempos (de graça, para repositórios públicos) e salva o resultado no repositório. O app só consome esse arquivo pronto. É por isso que dá pra ter atualização 100% automática, sem você precisar rodar nada manualmente — mas o "cérebro" que busca as notícias mora no GitHub Actions, não no celular.

Isso ainda é compatível com o seu jeito de trabalhar (sem terminal/Git na maioria das vezes): você sobe os arquivos pela própria interface do GitHub no navegador (arrastar e soltar), e o GitHub Actions funciona sozinho a partir do arquivo `.github/workflows/aggregate.yml` que já vai dentro do projeto.

---

## Passo a passo para publicar

### 1. Criar o repositório
1. Entre em [github.com](https://github.com) → **New repository**.
2. Nome sugerido: `trem-de-noticias`. Marque como **público** (necessário para o GitHub Actions gratuito e para o GitHub Pages gratuito).
3. Crie o repositório vazio (sem README).

### 2. Subir os arquivos
1. Na página do repositório, clique em **Add file → Upload files**.
2. Arraste **todo o conteúdo** desta pasta (incluindo as pastas `docs/`, `scripts/` e `.github/`) — o GitHub preserva a estrutura de pastas no upload.
3. Clique em **Commit changes**.

### 3. Ativar o GitHub Pages
1. Vá em **Settings → Pages**.
2. Em "Build and deployment", selecione **Deploy from a branch**.
3. Branch: `main`, pasta: **`/docs`**. Salve.
4. Em 1-2 minutos o app estará em `https://SEU-USUARIO.github.io/trem-de-noticias/`.

### 4. Ativar o GitHub Actions (o coletor automático)
1. Vá na aba **Actions** do repositório.
2. O workflow **"Coletar notícias automaticamente"** deve aparecer. Se o GitHub pedir para confirmar, clique em **"I understand my workflows, enable them"**.
3. Para testar na hora, clique em **Coletar notícias automaticamente → Run workflow**. Em 1-2 minutos, o arquivo `docs/data/news.json` será atualizado e o app já mostra o conteúdo novo.
4. Depois disso, ele roda sozinho a cada 30 minutos (configurável em `.github/workflows/aggregate.yml`, campo `cron`).

> ⚠️ O GitHub Actions precisa de permissão de escrita para commitar o `news.json` sozinho. Se o workflow falhar com erro de permissão, vá em **Settings → Actions → General → Workflow permissions** e marque **"Read and write permissions"**.

### 5. Instalar como app no celular
Abra o link do GitHub Pages no Chrome/Safari do celular → menu → **"Adicionar à tela inicial"** (ou o navegador vai sugerir instalar automaticamente). A partir daí funciona como um app normal, com ícone próprio, e abre offline.

---

## Cadastro de fontes (`scripts/sources.json`)

Cada fonte é um objeto:

```json
{
  "id": "g1-minas",
  "name": "G1 - Minas Gerais",
  "type": "rss",
  "url": "https://g1.globo.com/rss/g1/minas-gerais/",
  "region": "minas",
  "category_default": "acontecimentos",
  "trust_score": 78,
  "opinion_bias": 5,
  "priority": "high",
  "active": true
}
```

- **`type: "rss"`** — para sites com feed RSS/Atom (a maioria dos grandes portais tem).
- **`type: "html"`** — para sites sem RSS: o coletor abre a página inicial, segue os links internos e extrai título/resumo/imagem pelas tags `og:title`, `og:description`, `og:image` (metadados que a maioria dos sites de notícia já usa para pré-visualização no WhatsApp/Facebook). Funciona bem em portais bem estruturados; pode falhar em sites muito antigos ou muito diferentes do padrão.
- **`trust_score`** (0-100) e **`opinion_bias`** (0-100) são seus critérios manuais de confiança/viés da fonte — usados pelo classificador editorial.
- **`active: false`** desliga a fonte sem precisar apagar o cadastro.

### Sobre Cláudio-MG especificamente
Já deixei cadastradas e **ativas** as fontes reais que encontrei para Cláudio e região:

| Fonte | Como é coletada |
|---|---|
| Prefeitura de Cláudio | Site oficial (modo HTML) |
| Câmara Municipal de Cláudio | Site oficial (modo HTML) |
| TribunaWeb (jornais Tribuna do Carmo / Tribuna de Cláudio) | RSS do blog |
| DiviNews — tag Cláudio-MG | RSS filtrado |
| DiviNews — geral (Divinópolis e região) | RSS |
| Guia Cláudio Online — Notícias | Modo HTML |

**Não deu pra incluir automaticamente** (ficam marcadas como não coletáveis em `sources.json`, com a explicação): Folha Claudiense, Jornal Cidade Carinho, Enquanto isso em Cláudio e a Rádio Ind FM 107.1 só publicam no Instagram/Facebook (ou, no caso da Ind FM, o site é só de player/promoções, sem notícias em texto) — essas redes não permitem coleta automática pelos termos de uso. O "Jornal A Notícia" que encontrei é de Carmo da Mata, não de Cláudio, então não incluí. Não encontrei um "Papiro Online" de Cláudio — se você tiver o link certo, é só me passar (ou pedir pra eu adicionar) que eu cadastro.

Se qualquer uma dessas fontes ganhar um site próprio no futuro, ou se você tiver a URL exata de alguma que eu não achei, é só me falar o nome e o link (ou até só o nome) que eu mesmo edito o `sources.json` pra você — você não precisa escrever nada.

Além disso, o app tem um reforço automático: qualquer notícia de Minas Gerais ou Brasil que **mencione** o nome de uma cidade da sua lista de "região próxima" (configurável dentro do próprio app, em Ajustes) aparece destacada na aba "Região", mesmo vindo de uma fonte grande.

**Não incluí scraping de Instagram/Facebook** — essas plataformas não permitem esse tipo de coleta automática nos termos de uso, e isso poderia derrubar o acesso do seu app. Se quiser conteúdo de redes sociais, o caminho seguro é publicar manualmente ou usar as APIs oficiais (exigem aprovação/autenticação).

---

## Como funciona o filtro editorial

`scripts/classifier.js` dá uma nota a cada notícia com base em:
- presença de expressões opinativas ("na minha opinião", "é um absurdo"...);
- presença de expressões factuais ("segundo", "de acordo com", "em nota"...);
- sensacionalismo (caixa alta, pontuação exagerada, palavras como "chocante", "urgente");
- se a seção/categoria da fonte já indica opinião/coluna/editorial;
- a nota manual de confiança e viés que você deu à fonte em `sources.json`.

Isso gera `contentType` (notícia / opinião / coluna / editorial / informe), `neutralityScore` e `reliabilityScore` por item — usados para as etiquetas nos cards e para o controle **"Nível de filtro contra conteúdo opinativo"** dentro do app (Ajustes → Filtro editorial: Baixo / Moderado / Alto).

É uma heurística de regras, auditável e sem caixa-preta — não é um modelo de IA. O campo está pronto para, no futuro, ser trocado por uma chamada a um modelo de linguagem (comentário no código indica onde plugar).

---

## Testar o coletor no computador (opcional)

```bash
cd scripts
npm install
node aggregate.js      # roda a coleta de verdade e atualiza docs/data/news.json
node seed.js            # regenera os dados de EXEMPLO (cuidado: sobrescreve o news.json)
```

Requer Node.js 18 ou mais recente (usa `fetch` nativo).

---

## Estrutura de pastas

```
trem-de-noticias/
├── docs/                     ← isso é o site publicado (GitHub Pages)
│   ├── index.html
│   ├── manifest.json
│   ├── service-worker.js
│   ├── css/style.css
│   ├── js/app.js
│   ├── icons/, img/
│   └── data/news.json        ← gerado automaticamente pelo coletor
├── scripts/
│   ├── aggregate.js           ← coletor principal
│   ├── classifier.js          ← classificador editorial
│   ├── seed.js                ← gera dados de exemplo
│   ├── sources.json           ← cadastro de fontes/regiões/categorias
│   └── package.json
└── .github/workflows/aggregate.yml   ← roda o coletor automaticamente
```

## Limitações conhecidas
- A qualidade do modo `"html"` depende de cada site ter metadados Open Graph decentes; sites muito simples podem não extrair bem.
- URLs de RSS mudam de tempos em tempos — o coletor ignora e loga (na aba Actions) qualquer fonte que falhar, sem quebrar o restante.
- Notícias hiperlocais de Cláudio-MG dependem de você cadastrar as fontes locais reais (não vêm prontas, porque a maioria não tem RSS público conhecido).
- O classificador editorial é uma heurística de texto, não uma verificação factual — trate como apoio, não como veredito.

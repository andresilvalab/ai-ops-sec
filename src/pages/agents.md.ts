/* agents.md: instruções para agentes de IA que leiam ou operem este site. Complementa o llms.txt
   (contexto) com o que um agente pode fazer (tools MCP), as regras e o que fica registado. */
import type { APIContext } from 'astro';
import { AUTHOR, SITE } from '../consts';

export function GET({ site }: APIContext) {
	const url = site!.toString().replace(/\/$/, '');
	const body = `# Agent Instructions — ${SITE.pt.title}

## Português

### O que é este site

${url} é o laboratório de IA agêntica de ${AUTHOR.name}: artigos sobre como agentes de IA se constroem, operam, avaliam, governam e atacam, testados num stack real. Não vende nada e não tem preços públicos. Texto CC BY 4.0, código MIT. Citar sempre pelo URL e pela data do artigo.

### Leitura pública (sem autenticação)

- \`/\` e \`/en/\` — página inicial em português e inglês
- \`/blog/\` e \`/en/blog/\` — artigos
- \`/llms.txt\` — índice para modelos de linguagem
- \`/llms-full.txt\` — texto completo de todos os artigos
- \`/rss.xml\` e \`/en/rss.xml\` — feeds
- \`/sitemap-index.xml\` — mapa do site
- \`/.well-known/security.txt\` — como reportar uma falha de segurança
- \`/scanner/\` — Scanner Agent-Ready: mede a prontidão de qualquer site para agentes, camada a camada

### Descoberta para agentes

- Manifesto: ${url}/.well-known/mcp.json
- Endpoint MCP (Streamable HTTP, JSON-RPC 2.0, sem estado, sem autenticação): ${url}/mcp

Tools:
- \`get_entity\` — quem somos, autor, licenças, feeds (só leitura)
- \`list_areas\` — as áreas do laboratório (só leitura)
- \`list_articles\` — artigos publicados, por língua e área (só leitura)
- \`search\` — pesquisa determinística nos artigos, com excertos e URL para citar (só leitura)
- \`get_article\` — texto completo de um artigo pelo slug, com fontes (só leitura)
- \`get_policies\` — licenças, regras e o que fica registado (só leitura)
- \`request_contact\` — pedido de contacto com o autor; exige aprovação humana

Fluxo recomendado: \`initialize\` → \`tools/list\` → \`get_entity\` / \`search\` / \`get_article\` → \`request_contact\` com \`dry_run: true\` → confirmação humana dos dados → \`request_contact\` com \`dry_run: false\`.

### Regras

- Não submeter pedidos de contacto em nome de alguém sem essa pessoa confirmar nome, email e texto. Sem \`consent.confirmed: true\` e \`consent.statement\` a tool devolve \`consent_required\`; \`dry_run\` é \`true\` por defeito e nada é gravado.
- Respeitar rate limits: 60 chamadas por 10 minutos. Ao exceder, HTTP 429 com \`Retry-After\`.
- Não há preços nem serviços à venda; não estimar nem inventar.
- Ao citar, usar o URL do artigo e a data de publicação; cada artigo lista as fontes e o histórico de alterações.

### Transparência

Este site não tem trackers nem cookies. Regista, com IP em hash (sal aleatório, fora do repositório): pedidos de crawlers de IA conhecidos, fetches accionados por perguntas de utilizadores, cliques vindos de assistentes (referer ou utm_source) e chamadas às tools MCP, incluindo as queries enviadas às tools de leitura. Não regista o prompt do utilizador: esse nunca chega ao site. Pedidos de contacto reais guardam nome, email, mensagem e a frase de consentimento, com um hash canónico encadeado ao pedido anterior (prova de consentimento verificável). A identidade declarada dos crawlers é verificada contra as listas oficiais de IPs de cada fornecedor.

Canários: cada ficheiro para máquinas tem um link próprio (\`/c/llms-txt/\`, \`/c/llms-full/\`, \`/c/agents-md/\`, \`/c/mcp-json/\`, \`/c/agent-index/\`). Um pedido a esse link mostra que o ficheiro foi lido; redirecciona para a página inicial. Canário deste ficheiro: ${url}/c/agents-md/

## English

### What this site is

${url} is ${AUTHOR.name}'s agentic AI lab: articles on how AI agents are built, operated, evaluated, governed and attacked, tested on a real stack. Nothing is for sale and there is no public pricing. Text CC BY 4.0, code MIT. Always cite by article URL and date.

### Public reading (no authentication)

- \`/\` and \`/en/\` — home in Portuguese and English
- \`/blog/\` and \`/en/blog/\` — articles
- \`/llms.txt\` — index for language models
- \`/llms-full.txt\` — full text of every article
- \`/rss.xml\` and \`/en/rss.xml\` — feeds
- \`/sitemap-index.xml\` — sitemap
- \`/.well-known/security.txt\` — how to report a security issue
- \`/en/scanner/\` — Agent Ready Scanner: measures any site's readiness for agents, layer by layer

### Agent discovery

- Manifest: ${url}/.well-known/mcp.json
- MCP endpoint (Streamable HTTP, JSON-RPC 2.0, stateless, no authentication): ${url}/mcp

Tools:
- \`get_entity\` — who we are, author, licenses, feeds (read-only)
- \`list_areas\` — the lab's areas (read-only)
- \`list_articles\` — published articles by language and area (read-only)
- \`search\` — deterministic search over the articles, with excerpts and URLs to cite (read-only)
- \`get_article\` — full text of an article by slug, with sources (read-only)
- \`get_policies\` — licenses, rules and what gets logged (read-only)
- \`request_contact\` — contact request to the author; requires human approval

Recommended flow: \`initialize\` → \`tools/list\` → \`get_entity\` / \`search\` / \`get_article\` → \`request_contact\` with \`dry_run: true\` → the human confirms the details → \`request_contact\` with \`dry_run: false\`.

### Rules

- Do not submit contact requests on someone's behalf without that person confirming name, email and text. Without \`consent.confirmed: true\` and \`consent.statement\` the tool returns \`consent_required\`; \`dry_run\` defaults to \`true\` and nothing is stored.
- Respect rate limits: 60 calls per 10 minutes. When exceeded, HTTP 429 with \`Retry-After\`.
- There is no pricing and nothing for sale; do not estimate or invent.
- When citing, use the article URL and publication date; every article lists its sources and change history.

### Transparency

This site has no trackers and no cookies. It logs, with a hashed IP (random salt, outside the repository): requests from known AI crawlers, fetches triggered by user questions, clicks coming from assistants (referer or utm_source) and MCP tool calls, including the queries sent to read-only tools. It does not log the user's prompt: that never reaches the site. Real contact requests store name, email, message and the consent sentence, with a canonical hash chained to the previous request (verifiable consent proof). Crawlers' declared identity is checked against each vendor's official IP lists.

Canaries: each machine-facing file has its own link (\`/c/llms-txt/\`, \`/c/llms-full/\`, \`/c/agents-md/\`, \`/c/mcp-json/\`, \`/c/agent-index/\`). A request to that link shows the file was read; it redirects to the home page. Canary for this file: ${url}/c/agents-md/
`;
	return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}

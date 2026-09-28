# Política de segurança

Site estático com um Worker na frente. O Worker regista pedidos de agentes de IA (IP só em hash com sal), serve
um servidor MCP só de leitura em `/mcp`, um scanner público em `/api/scan` e guarda pedidos de contacto que a
pessoa confirmou. O export destes dados para o autor é autenticado. Tudo isto está no âmbito: uma falha no
Worker, no MCP, no scanner (por exemplo um pedido a rede interna), um script injectado, um cabeçalho em falta
ou uma dependência comprometida conta.

**Reportar:** abre um aviso privado em
https://github.com/andresilvalab/ai-ops-sec/security/advisories/new. Não uses issues
públicos para vulnerabilidades. Resposta inicial no prazo de 7 dias.

**Âmbito:** o código deste repositório, o build publicado e a cadeia de dependências.

**Fora de âmbito:** conteúdo dos artigos (para correcções factuais abre um issue ou um pull
request), infraestrutura do GitHub ou do CDN.

**Divulgação:** coordenada. Depois da correcção, a falha e quem a reportou (se quiser) ficam
registados no changelog do repositório.

`/.well-known/security.txt` (RFC 9116) aponta para esta política.

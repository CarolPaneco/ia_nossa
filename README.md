# Portal de IA

Portal web em Node.js para conversar com um provedor de IA que tenha sido aprovado pela empresa. Suporta a API Gemini e APIs de chat completions compatíveis com OpenAI. A chave é configurada apenas no servidor.

## Executar localmente

Requer Node.js 20 ou superior.

Para usar o Gemini:

1. Confirme com a empresa que você pode usar o Gemini para esse trabalho e quais dados podem ser enviados. O nível gratuito pode ter limites e condições de privacidade diferentes; consulte os [termos e preços do Gemini API](https://ai.google.dev/gemini-api/docs/pricing).
2. Crie uma chave no [Google AI Studio](https://aistudio.google.com/app/apikey). Não a compartilhe nem a coloque no código.
3. No terminal PowerShell do VS Code, na pasta do projeto, execute:

```powershell
$env:LLM_PROVIDER = "gemini"
$env:LLM_MODEL = "gemini-2.5-flash"
$chave = Read-Host "Cole a chave criada no Google AI Studio" -AsSecureString
$env:LLM_API_KEY = [System.Net.NetworkCredential]::new("", $chave).Password
$env:PORT = "3001"
npm start
```

4. Abra `http://localhost:3001`. Deixe esse terminal aberto enquanto usa o portal.

O servidor usa a API oficial `generateContent` do Gemini. O modelo indicado é um exemplo; confira os modelos disponíveis e acesso da sua chave na [documentação oficial](https://ai.google.dev/gemini-api/docs/models). A disponibilidade do nível gratuito, os modelos, os limites e os termos podem mudar. Se sua organização não autorizar o Gemini, não conecte uma chave pessoal nem envie informações de trabalho.

Para outra API compatível com OpenAI, configure `LLM_API_URL`, `LLM_API_KEY` e `LLM_MODEL`, mantendo `LLM_PROVIDER` como `openai` ou sem defini-lo:

```powershell
$env:LLM_PROVIDER = "openai"
$env:LLM_API_URL = "https://api-do-provedor-aprovado.example/v1/chat/completions"
$env:LLM_API_KEY = "chave-fornecida-pela-equipe-responsavel"
$env:LLM_MODEL = "modelo-aprovado"
npm start
```

Sem as configurações necessárias, a interface informa que o serviço não está pronto e não inventa respostas.

## Publicar no Render

1. Publique este projeto em um repositório autorizado pela empresa e crie um Web Service no Render.
2. Configure o comando de início como `npm start`.
3. Para Gemini, cadastre `LLM_PROVIDER=gemini`, `LLM_API_KEY` e `LLM_MODEL` como variáveis de ambiente privadas do serviço. Para APIs compatíveis com OpenAI, cadastre `LLM_PROVIDER=openai`, `LLM_API_URL`, `LLM_API_KEY` e `LLM_MODEL`. Não coloque a chave no código, no navegador ou em variáveis `VITE_*`/`NEXT_PUBLIC_*`.
4. Use somente um endpoint e uma conta de IA autorizados pela empresa. Confirme também com a equipe responsável que hospedar o portal no Render é permitido.
5. Teste o acesso a partir da rede do trabalho com a equipe de TI. Hospedar o site não remove bloqueios de rede e não permite contornar políticas corporativas.

As mensagens são enviadas ao provedor configurado. Não insira dados pessoais, confidenciais ou internos a menos que as regras da empresa e o provedor aprovado permitam explicitamente esse uso. Este protótipo não implementa autenticação de usuários; antes de expô-lo além de um ambiente controlado, integre o login corporativo e os controles de acesso exigidos pela empresa.

## Testes

```powershell
npm test
```

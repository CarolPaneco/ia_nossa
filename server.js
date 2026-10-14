const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 8000;

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let tooLarge = false;

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return false;
  }

  return messages.every(
    (message) =>
      message &&
      ["user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      message.content.length <= MAX_MESSAGE_LENGTH,
  ) && messages[messages.length - 1].role === "user";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function createServer(config = {}) {
  const settings = {
    provider: config.provider ?? process.env.LLM_PROVIDER ?? "openai",
    apiUrl: config.apiUrl ?? process.env.LLM_API_URL,
    apiKey: config.apiKey ?? process.env.LLM_API_KEY,
    model: config.model ?? process.env.LLM_MODEL ?? ((config.provider ?? process.env.LLM_PROVIDER) === "gemini" ? "gemini-3.8-flash" : undefined),
    fetchImpl: config.fetchImpl ?? fetch,
  };

  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

    let requestUrl;
    try {
      requestUrl = new URL(req.url, "http://localhost");
    } catch {
      sendJson(res, 400, { error: "Requisição inválida." });
      return;
    }

    if (requestUrl.pathname === "/api/chat") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        sendJson(res, 405, { error: "Método não permitido." });
        return;
      }

      if (!["openai", "gemini"].includes(settings.provider)) {
        sendJson(res, 503, { error: "O provedor de IA configurado não é compatível." });
        return;
      }

      if (!settings.apiKey || !settings.model || (settings.provider === "openai" && !settings.apiUrl)) {
        sendJson(res, 503, { error: "O serviço de IA ainda não foi configurado pela equipe responsável." });
        return;
      }

      let endpoint;
      try {
        endpoint = settings.provider === "gemini"
          ? new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`)
          : new URL(settings.apiUrl);
      } catch {
        sendJson(res, 503, { error: "A URL da API configurada é inválida." });
        return;
      }
      if (endpoint.protocol !== "https:") {
        sendJson(res, 503, { error: "A API deve usar uma conexão HTTPS segura." });
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req);
      } catch (error) {
        sendJson(res, error.statusCode ?? 400, {
          error: error.statusCode === 413 ? "A solicitação excede o limite permitido." : "Não foi possível ler a solicitação.",
        });
        return;
      }

      if (!payload || !validateMessages(payload.messages)) {
        sendJson(res, 400, { error: "Envie uma conversa válida para continuar." });
        return;
      }

      try {
        const headers = { "Content-Type": "application/json" };
        let requestBody;
        if (settings.provider === "gemini") {
          headers["x-goog-api-key"] = settings.apiKey;
          requestBody = {
            contents: payload.messages.map((message) => ({
              role: message.role === "assistant" ? "model" : "user",
              parts: [{ text: message.content }],
            })),
          };
        } else {
          headers.Authorization = `Bearer ${settings.apiKey}`;
          requestBody = {
            model: settings.model,
            messages: payload.messages,
            stream: false,
          };
        }

        const upstream = await settings.fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(45_000),
          headers,
          body: JSON.stringify(requestBody),
        });

        if (!upstream.ok) {
          const responseText = await upstream.text();
          if (Buffer.byteLength(responseText) > MAX_RESPONSE_BYTES) {
            sendJson(res, 502, { error: "A resposta do provedor excedeu o limite permitido." });
            return;
          }

          let providerMessage;
          try {
            const errorData = JSON.parse(responseText);
            providerMessage = errorData?.error?.message;
          } catch {
            providerMessage = undefined;
          }

          console.error(`O provedor de IA respondeu com HTTP ${upstream.status}.`);
          const providerLabel = settings.provider === "gemini" ? "Gemini" : "Provedor";
          const detail = typeof providerMessage === "string" && providerMessage.trim()
            ? ` ${providerLabel}: ${providerMessage.slice(0, 300)}`
            : "";
          sendJson(res, 502, { error: `O provedor de IA respondeu com HTTP ${upstream.status}.${detail}` });
          return;
        }

        const responseText = await upstream.text();
        if (Buffer.byteLength(responseText) > MAX_RESPONSE_BYTES) {
          sendJson(res, 502, { error: "A resposta do provedor excedeu o limite permitido." });
          return;
        }

        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          sendJson(res, 502, { error: "O provedor de IA retornou uma resposta inválida." });
          return;
        }

        const answer = settings.provider === "gemini"
          ? responseData?.candidates?.[0]?.content?.parts
            ?.map((part) => part.text)
            .filter((text) => typeof text === "string")
            .join("")
          : responseData?.choices?.[0]?.message?.content;
        if (typeof answer !== "string" || !answer.trim()) {
          sendJson(res, 502, { error: "O provedor de IA não retornou uma resposta utilizável." });
          return;
        }
        sendJson(res, 200, { answer });
      } catch (error) {
        const causeCode = error.cause?.code;
        const diagnostic = error.cause instanceof Error ? error.cause : error;
        const diagnosticMessage = String(diagnostic.message ?? "")
          .replaceAll(settings.apiKey, "[chave ocultada]")
          .slice(0, 240);
        console.error("Falha ao conectar ao provedor de IA:", error.name, causeCode ?? "", diagnosticMessage);
        const networkError = ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(causeCode);
        const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
        const message = networkError
          ? "Não foi possível alcançar o provedor de IA. Verifique a conexão ou consulte a equipe de TI sobre o acesso à API."
          : timedOut
            ? "A conexão com o provedor de IA excedeu o tempo limite. Tente novamente."
            : "Não foi possível conectar ao provedor de IA. Verifique a conexão e tente novamente.";
        sendJson(res, 502, { error: message });
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      sendJson(res, 405, { error: "Método não permitido." });
      return;
    }

    const staticFile = STATIC_FILES[requestUrl.pathname];
    if (!staticFile) {
      sendJson(res, 404, { error: "Página não encontrada." });
      return;
    }

    const [fileName, contentType] = staticFile;
    const fileContents = fs.readFileSync(path.join(PUBLIC_DIR, fileName));
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : fileContents);
  });
}

if (require.main === module) {
  const server = createServer();
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Portal de IA disponível na porta ${port}.`);
  });
}

module.exports = { createServer };

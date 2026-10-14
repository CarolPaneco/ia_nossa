const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 500_000;

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
      message.content.length <= MAX_MESSAGE_LENGTH &&
      (message.image === undefined || typeof message.image === "string"),
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
  const provider = config.provider ?? process.env.LLM_PROVIDER ?? "openai";
  const defaultApiUrl = provider === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : provider === "openai"
      ? (config.apiUrl ?? process.env.LLM_API_URL)
      : undefined;

  const defaultModel = provider === "groq"
    ? "openai/gpt-oss-120b"
    : provider === "gemini"
      ? "gemini-3.8-flash"
      : undefined;

  const settings = {
    provider,
    apiUrl: config.apiUrl ?? process.env.LLM_API_URL ?? defaultApiUrl,
    apiKey: config.apiKey ?? process.env.LLM_API_KEY,
    model: config.model ?? process.env.LLM_MODEL ?? defaultModel,
    fetchImpl: config.fetchImpl ?? fetch,
  };

  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self' https:; img-src 'self' data: https: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );

    let requestUrl;
    try {
      requestUrl = new URL(req.url, "http://localhost");
    } catch {
      sendJson(res, 400, { error: "Requisição inválida." });
      return;
    }

    if (requestUrl.pathname === "/api/models" && req.method === "GET") {
      if (!settings.apiKey) {
        sendJson(res, 503, { error: "Chave de API não configurada." });
        return;
      }
      try {
        let modelsUrl;
        const headers = {};
        if (settings.provider === "gemini") {
          modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(settings.apiKey)}`;
        } else {
          modelsUrl = settings.provider === "groq"
            ? "https://api.groq.com/openai/v1/models"
            : (settings.apiUrl ? new URL("/v1/models", settings.apiUrl).toString() : "https://api.openai.com/v1/models");
          headers.Authorization = `Bearer ${settings.apiKey}`;
        }
        const resp = await settings.fetchImpl(modelsUrl, { headers, signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
          const errText = await resp.text();
          sendJson(res, resp.status, { error: `Erro ao buscar modelos (${resp.status}): ${errText.slice(0, 300)}` });
          return;
        }
        const data = await resp.json();
        const models = settings.provider === "gemini"
          ? (data.models || []).map((m) => m.name.replace("models/", ""))
          : (data.data || []).map((m) => m.id);
        sendJson(res, 200, { provider: settings.provider, count: models.length, models });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    if (requestUrl.pathname === "/api/generate-image") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        sendJson(res, 405, { error: "Método não permitido." });
        return;
      }
      let payload;
      try {
        payload = await readJsonBody(req);
      } catch (error) {
        sendJson(res, error.statusCode ?? 400, { error: "Não foi possível ler a solicitação." });
        return;
      }
      if (!payload?.prompt || typeof payload.prompt !== "string" || !payload.prompt.trim()) {
        sendJson(res, 400, { error: "Envie uma descrição para a imagem." });
        return;
      }
      const prompt = payload.prompt.trim().slice(0, 1000);
      const seed = Math.floor(Math.random() * 1_000_000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
      sendJson(res, 200, { imageUrl, prompt });
      return;
    }

    if (requestUrl.pathname === "/api/chat") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        sendJson(res, 405, { error: "Método não permitido." });
        return;
      }

      if (!["openai", "gemini", "groq"].includes(settings.provider)) {
        sendJson(res, 503, { error: "O provedor de IA configurado não é compatível." });
        return;
      }

      if (!settings.apiKey || !settings.model || (["openai", "groq"].includes(settings.provider) && !settings.apiUrl)) {
        sendJson(res, 503, { error: "O serviço de IA ainda não foi configurado pela equipe responsável." });
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

      const chosenModel = (typeof payload.model === "string" && payload.model.trim())
        ? payload.model.trim()
        : settings.model;

      let endpoint;
      try {
        endpoint = settings.provider === "gemini"
          ? new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`)
          : new URL(settings.apiUrl);
      } catch {
        sendJson(res, 503, { error: "A URL da API configurada é inválida." });
        return;
      }
      if (endpoint.protocol !== "https:") {
        sendJson(res, 503, { error: "A API deve usar uma conexão HTTPS segura." });
        return;
      }

      try {
        const headers = { "Content-Type": "application/json" };
        let requestBody;
        if (settings.provider === "gemini") {
          headers["x-goog-api-key"] = settings.apiKey;
          requestBody = {
            contents: payload.messages.map((message) => {
              const parts = [{ text: message.content }];
              if (message.image && typeof message.image === "string" && message.image.startsWith("data:")) {
                const match = message.image.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  parts.push({
                    inline_data: {
                      mime_type: match[1],
                      data: match[2],
                    },
                  });
                }
              }
              return {
                role: message.role === "assistant" ? "model" : "user",
                parts,
              };
            }),
          };
        } else {
          headers.Authorization = `Bearer ${settings.apiKey}`;
          requestBody = {
            model: chosenModel,
            messages: payload.messages.map((message) => {
              if (message.image && typeof message.image === "string" && message.image.startsWith("data:")) {
                return {
                  role: message.role,
                  content: [
                    { type: "text", text: message.content },
                    { type: "image_url", image_url: { url: message.image } },
                  ],
                };
              }
              return {
                role: message.role,
                content: message.content,
              };
            }),
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

          console.error(`O provedor de IA (${endpoint.hostname}) respondeu com HTTP ${upstream.status}.`);
          const providerLabel = settings.provider === "gemini" ? "Gemini" : "Provedor";
          const detail = typeof providerMessage === "string" && providerMessage.trim()
            ? ` ${providerLabel}: ${providerMessage.slice(0, 300)}`
            : "";
          sendJson(res, 502, { error: `O provedor de IA (${endpoint.hostname}) respondeu com HTTP ${upstream.status}.${detail}` });
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

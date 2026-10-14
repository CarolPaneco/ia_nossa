const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createServer } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("serves the chat interface with security headers", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(await response.text(), /Assistente de IA/);
});

test("reports an unconfigured provider instead of simulating a response", async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Oi" }] }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /não foi configurado/);
});

test("does not expose a provider key in the browser page", async () => {
  const response = await fetch(baseUrl);
  assert.doesNotMatch(await response.text(), /LLM_API_KEY|Authorization/);
});

test("forwards chat to the configured provider from the server", async () => {
  let receivedRequest;
  const configuredServer = createServer({
    apiUrl: "https://provider.example/v1/chat/completions",
    apiKey: "server-only-secret",
    model: "approved-model",
    fetchImpl: async (url, options) => {
      receivedRequest = { url: String(url), options };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Resposta aprovada." } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  await new Promise((resolve) => configuredServer.listen(0, "127.0.0.1", resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${configuredServer.address().port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Oi" }] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answer: "Resposta aprovada." });
    assert.equal(receivedRequest.url, "https://provider.example/v1/chat/completions");
    assert.equal(receivedRequest.options.headers.Authorization, "Bearer server-only-secret");
    assert.deepEqual(JSON.parse(receivedRequest.options.body), {
      model: "approved-model",
      messages: [{ role: "user", content: "Oi" }],
      stream: false,
    });
  } finally {
    await new Promise((resolve, reject) => configuredServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("translates chat history to the Gemini API format without exposing the key", async () => {
  let receivedRequest;
  const geminiServer = createServer({
    provider: "gemini",
    apiKey: "server-only-secret",
    model: "gemini-2.5-flash",
    fetchImpl: async (url, options) => {
      receivedRequest = { url: String(url), options };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Resposta Gemini." }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  await new Promise((resolve) => geminiServer.listen(0, "127.0.0.1", resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${geminiServer.address().port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Oi" },
          { role: "assistant", content: "Olá" },
          { role: "user", content: "Como vai?" },
        ],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answer: "Resposta Gemini." });
    assert.equal(
      receivedRequest.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    assert.equal(receivedRequest.options.headers["x-goog-api-key"], "server-only-secret");
    assert.deepEqual(JSON.parse(receivedRequest.options.body), {
      contents: [
        { role: "user", parts: [{ text: "Oi" }] },
        { role: "model", parts: [{ text: "Olá" }] },
        { role: "user", parts: [{ text: "Como vai?" }] },
      ],
    });
    assert.doesNotMatch(JSON.stringify(await fetch(baseUrl).then((page) => page.text())), /server-only-secret/);
  } finally {
    await new Promise((resolve, reject) => geminiServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("shows a useful Gemini API error when the provider rejects a request", async () => {
  const geminiServer = createServer({
    provider: "gemini",
    apiKey: "server-only-secret",
    model: "gemini-flash-latest",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "API key not valid. Please pass a valid API key." },
    }), { status: 400, headers: { "Content-Type": "application/json" } }),
  });
  await new Promise((resolve) => geminiServer.listen(0, "127.0.0.1", resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${geminiServer.address().port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Oi" }] }),
    });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /HTTP 400.*API key not valid/);
  } finally {
    await new Promise((resolve, reject) => geminiServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("logs a sanitized network diagnostic when Gemini fetch fails", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  const geminiServer = createServer({
    provider: "gemini",
    apiKey: "secret-to-redact",
    model: "gemini-flash-latest",
    fetchImpl: async () => {
      const error = new TypeError("fetch failed");
      error.cause = Object.assign(new Error("connect ECONNRESET using secret-to-redact"), {
        code: "ECONNRESET",
      });
      throw error;
    },
  });
  await new Promise((resolve) => geminiServer.listen(0, "127.0.0.1", resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${geminiServer.address().port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Oi" }] }),
    });
    assert.equal(response.status, 502);
    assert.match(logged.join("\n"), /ECONNRESET.*chave ocultada/);
    assert.doesNotMatch(logged.join("\n"), /secret-to-redact/);
  } finally {
    console.error = originalConsoleError;
    await new Promise((resolve, reject) => geminiServer.close((error) => error ? reject(error) : resolve()));
  }
});

const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const messagesContainer = document.querySelector("#messages");
const sendButton = document.querySelector("#send");
const errorMessage = document.querySelector("#error");
const modelSelect = document.querySelector("#model-select");
const attachBtn = document.querySelector("#attach-btn");
const fileInput = document.querySelector("#file-input");
const imageModeBtn = document.querySelector("#image-mode-btn");
const attachmentPreview = document.querySelector("#attachment-preview");
const attachmentIcon = document.querySelector("#attachment-icon");
const attachmentName = document.querySelector("#attachment-name");
const attachmentSize = document.querySelector("#attachment-size");
const attachmentRemove = document.querySelector("#attachment-remove");

const conversation = [];
let currentAttachment = null;

// Carregar modelos disponíveis na inicialização
async function loadAvailableModels() {
  try {
    const res = await fetch("/api/models");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.models) && data.models.length > 0) {
      // Filtrar modelos recomendados para chat / visão
      const textModels = data.models.filter(
        (m) => !m.includes("whisper") && !m.includes("guard") && !m.includes("orpheus"),
      );
      if (textModels.length > 0) {
        modelSelect.innerHTML = "";
        for (const model of textModels) {
          const opt = document.createElement("option");
          opt.value = model;
          let label = model;
          if (model === "openai/gpt-oss-120b") label = "GPT-OSS 120B (Mais potente / Código)";
          else if (model === "openai/gpt-oss-20b") label = "GPT-OSS 20B (Rápido)";
          else if (model === "qwen/qwen3.8-27b") label = "Qwen 27B (Imagens & Visão)";
          else if (model === "gemini-3.8-flash") label = "Gemini 3.8 Flash";
          opt.textContent = label;
          modelSelect.append(opt);
        }
      }
    }
  } catch {
    // Mantém as opções padrão caso a consulta falhe
  }
}
loadAvailableModels();

// Sanitização básica contra XSS
function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Renderizador de Markdown em HTML
function renderMarkdown(rawText) {
  // 1. Isolar blocos de código ```lang ... ```
  const codeBlocks = [];
  let processed = rawText.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const id = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({ lang: lang || "codigo", code });
    return id;
  });

  // 2. Escapar HTML no restante do texto
  processed = escapeHtml(processed);

  // 3. Títulos (#, ##, ###)
  processed = processed.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  processed = processed.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  processed = processed.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // 4. Negrito e Itálico
  processed = processed.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  processed = processed.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // 5. Código inline `code`
  processed = processed.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 6. Listas não ordenadas
  processed = processed.replace(/^\s*[-*]\s+(.*)$/gim, "<li>$1</li>");
  processed = processed.replace(/(<li>.*<\/li>)/gms, "<ul>$1</ul>");

  // 7. Quebras de linha
  processed = processed.replace(/\n\n+/g, "</p><p>");
  processed = processed.replace(/\n/g, "<br>");
  processed = `<p>${processed}</p>`;

  // 8. Reintroduzir blocos de código formatados com botão de cópia
  for (let i = 0; i < codeBlocks.length; i++) {
    const { lang, code } = codeBlocks[i];
    const escapedCode = escapeHtml(code);
    const blockHtml = `
      <div class="code-container">
        <div class="code-header">
          <span class="code-lang">${escapeHtml(lang)}</span>
          <button type="button" class="copy-code-btn" data-code="${encodeURIComponent(code)}">
            📋 Copiar código
          </button>
        </div>
        <pre><code class="language-${escapeHtml(lang)}">${escapedCode}</code></pre>
      </div>
    `;
    processed = processed.replace(`__CODE_BLOCK_${i}__`, blockHtml);
  }

  return processed;
}

// Criar elemento de mensagem na tela
function addMessage(role, content, options = {}) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "IA";
    article.append(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Se houver anexo visual de imagem enviado pelo usuário
  if (options.userImage) {
    const imgEl = document.createElement("img");
    imgEl.src = options.userImage;
    imgEl.className = "message-attachment-img";
    imgEl.alt = "Imagem anexada";
    bubble.append(imgEl);
  }

  // Se houver anexo de documento no card do usuário
  if (options.docName) {
    const badge = document.createElement("div");
    badge.className = "doc-badge";
    badge.textContent = `📎 ${options.docName}`;
    bubble.append(badge);
  }

  // Se for imagem gerada por IA
  if (options.generatedImageUrl) {
    const imgContainer = document.createElement("div");
    imgContainer.className = "generated-image-card";

    const img = document.createElement("img");
    img.src = options.generatedImageUrl;
    img.alt = content || "Imagem gerada por IA";
    img.className = "generated-img";

    const actions = document.createElement("div");
    actions.className = "img-actions";

    const downloadLink = document.createElement("a");
    downloadLink.href = options.generatedImageUrl;
    downloadLink.target = "_blank";
    downloadLink.download = "imagem-ia.jpg";
    downloadLink.className = "download-action-btn";
    downloadLink.textContent = "📥 Baixar Imagem";

    actions.append(downloadLink);
    imgContainer.append(img, actions);
    bubble.append(imgContainer);
  } else {
    // Conteúdo de texto / markdown
    const mdContainer = document.createElement("div");
    mdContainer.className = "markdown-body";
    mdContainer.innerHTML = renderMarkdown(content);
    bubble.append(mdContainer);

    // Barra de ações (Copiar, Baixar TXT/DOC/PDF) para respostas da IA
    if (role === "assistant") {
      const actionsBar = document.createElement("div");
      actionsBar.className = "message-actions-bar";

      // 1. Botão Copiar Texto
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "action-pill-btn";
      copyBtn.textContent = "📋 Copiar";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(content);
        copyBtn.textContent = "✓ Copiado!";
        setTimeout(() => (copyBtn.textContent = "📋 Copiar"), 2000);
      });

      // 2. Botão Baixar .TXT
      const downloadTxtBtn = document.createElement("button");
      downloadTxtBtn.type = "button";
      downloadTxtBtn.className = "action-pill-btn";
      downloadTxtBtn.textContent = "📄 Baixar .TXT";
      downloadTxtBtn.addEventListener("click", () => {
        downloadBlob(content, "resposta-ia.txt", "text/plain;charset=utf-8");
      });

      // 3. Botão Baixar .DOC (Word)
      const downloadDocBtn = document.createElement("button");
      downloadDocBtn.type = "button";
      downloadDocBtn.className = "action-pill-btn";
      downloadDocBtn.textContent = "📝 Baixar .DOC";
      downloadDocBtn.addEventListener("click", () => {
        const docContent = `<html><head><meta charset="utf-8"></head><body>${renderMarkdown(content)}</body></html>`;
        downloadBlob(docContent, "resposta-ia.doc", "application/msword;charset=utf-8");
      });

      // 4. Botão Imprimir / Salvar PDF
      const pdfBtn = document.createElement("button");
      pdfBtn.type = "button";
      pdfBtn.className = "action-pill-btn";
      pdfBtn.textContent = "🖨️ PDF";
      pdfBtn.addEventListener("click", () => {
        window.print();
      });

      actionsBar.append(copyBtn, downloadTxtBtn, downloadDocBtn, pdfBtn);
      bubble.append(actionsBar);
    }
  }

  article.append(bubble);
  messagesContainer.append(article);
  article.scrollIntoView({ behavior: "smooth", block: "nearest" });

  // Event listener para botões de cópia de código
  article.querySelectorAll(".copy-code-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rawCode = decodeURIComponent(btn.dataset.code || "");
      await navigator.clipboard.writeText(rawCode);
      const originalText = btn.textContent;
      btn.textContent = "✓ Código copiado!";
      setTimeout(() => (btn.textContent = originalText), 2000);
    });
  });
}

function downloadBlob(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Manipulação de Anexos (Documentos e Imagens)
attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const isImage = file.type.startsWith("image/");
  const reader = new FileReader();

  if (isImage) {
    reader.onload = () => {
      currentAttachment = {
        type: "image",
        name: file.name,
        size: formatBytes(file.size),
        dataUrl: reader.result,
      };
      showAttachmentPreview("🖼️", file.name, currentAttachment.size);
      // Se houver modelo de visão como Qwen, seleciona automaticamente
      const hasVision = Array.from(modelSelect.options).some((o) => o.value.includes("qwen"));
      if (hasVision) {
        modelSelect.value = "qwen/qwen3.8-27b";
      }
    };
    reader.readAsDataURL(file);
  } else {
    // Arquivo de texto / documento
    reader.onload = () => {
      currentAttachment = {
        type: "document",
        name: file.name,
        size: formatBytes(file.size),
        text: reader.result,
      };
      showAttachmentPreview("📄", file.name, currentAttachment.size);
    };
    reader.readAsText(file);
  }
});

function showAttachmentPreview(icon, name, size) {
  attachmentIcon.textContent = icon;
  attachmentName.textContent = name;
  attachmentSize.textContent = size;
  attachmentPreview.hidden = false;
  promptInput.focus();
}

attachmentRemove.addEventListener("click", () => {
  currentAttachment = null;
  fileInput.value = "";
  attachmentPreview.hidden = true;
});

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Botão rápido de modo de imagem
imageModeBtn.addEventListener("click", () => {
  promptInput.value = "/imagem ";
  promptInput.focus();
});

// Envio de Mensagens
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || sendButton.disabled) return;

  errorMessage.hidden = true;
  promptInput.value = "";
  promptInput.style.height = "auto";

  const attachmentToSend = currentAttachment;
  currentAttachment = null;
  fileInput.value = "";
  attachmentPreview.hidden = true;

  // 1. FLUXO DE GERAÇÃO DE IMAGEM (/imagem ...)
  if (prompt.startsWith("/imagem")) {
    const imagePrompt = prompt.replace(/^\/imagem\s*/i, "").trim();
    if (!imagePrompt) {
      errorMessage.textContent = "Digite o que você quer desenhar após /imagem (ex: /imagem um gato no espaço).";
      errorMessage.hidden = false;
      return;
    }

    addMessage("user", prompt);
    sendButton.disabled = true;
    sendButton.querySelector("span").textContent = "Gerando imagem...";

    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível gerar a imagem.");

      addMessage("assistant", `Aqui está a sua imagem para: **"${imagePrompt}"**`, {
        generatedImageUrl: data.imageUrl,
      });
    } catch (error) {
      errorMessage.textContent = error.message || "Erro ao gerar imagem. Tente novamente.";
      errorMessage.hidden = false;
    } finally {
      sendButton.disabled = false;
      sendButton.querySelector("span").textContent = "Enviar";
      promptInput.focus();
    }
    return;
  }

  // 2. FLUXO PADRÃO DE CHAT (Texto, Documento, Visão de Imagem)
  let userText = prompt;
  let userImage = null;

  if (attachmentToSend) {
    if (attachmentToSend.type === "document") {
      userText = `[Documento anexado: ${attachmentToSend.name}]\n"""\n${attachmentToSend.text}\n"""\n\n${prompt}`;
    } else if (attachmentToSend.type === "image") {
      userImage = attachmentToSend.dataUrl;
    }
  }

  const userMessageObj = { role: "user", content: userText };
  if (userImage) userMessageObj.image = userImage;

  conversation.push(userMessageObj);
  if (conversation.length > 20) conversation.splice(0, conversation.length - 20);

  addMessage("user", prompt, {
    userImage,
    docName: attachmentToSend?.type === "document" ? attachmentToSend.name : null,
  });

  sendButton.disabled = true;
  sendButton.querySelector("span").textContent = "Enviando...";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelSelect.value,
        messages: conversation,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível enviar a mensagem.");

    conversation.push({ role: "assistant", content: data.answer });
    addMessage("assistant", data.answer);
  } catch (error) {
    errorMessage.textContent = error.message || "Não foi possível conectar. Tente novamente.";
    errorMessage.hidden = false;
    conversation.pop();
  } finally {
    sendButton.disabled = false;
    sendButton.querySelector("span").textContent = "Enviar";
    promptInput.focus();
  }
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

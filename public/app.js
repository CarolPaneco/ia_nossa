const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const messagesContainer = document.querySelector("#messages");
const sendButton = document.querySelector("#send");
const errorMessage = document.querySelector("#error");
const modelSelect = document.querySelector("#model-select");
const attachBtn = document.querySelector("#attach-btn");
const fileInput = document.querySelector("#file-input");
const newChatBtn = document.querySelector("#new-chat-btn");
const attachmentPreview = document.querySelector("#attachment-preview");
const attachmentIcon = document.querySelector("#attachment-icon");
const attachmentName = document.querySelector("#attachment-name");
const attachmentSize = document.querySelector("#attachment-size");
const attachmentRemove = document.querySelector("#attachment-remove");

const conversation = [];
let currentAttachment = null;

// Carregar modelos disponíveis na inicialização (filtrando modelos árabes e não textuais)
async function loadAvailableModels() {
  try {
    const res = await fetch("/api/models");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.models) && data.models.length > 0) {
      const textModels = data.models.filter(
        (m) =>
          !m.includes("whisper") &&
          !m.includes("guard") &&
          !m.includes("orpheus") &&
          !m.includes("allam") &&
          !m.includes("arabic") &&
          !m.includes("safeguard"),
      );
      if (textModels.length > 0) {
        modelSelect.innerHTML = "";
        for (const model of textModels) {
          const opt = document.createElement("option");
          opt.value = model;
          let label = model;
          if (model === "openai/gpt-oss-120b") label = "GPT-OSS 120B (Mais potente)";
          else if (model === "openai/gpt-oss-20b") label = "GPT-OSS 20B (Rápido)";
          else if (model === "qwen/qwen3.8-27b") label = "Qwen 27B (Imagens & Visão)";
          else if (model === "gemini-3.8-flash") label = "Gemini 3.8 Flash";
          opt.textContent = label;
          modelSelect.append(opt);
        }
        if (textModels.includes("openai/gpt-oss-120b")) {
          modelSelect.value = "openai/gpt-oss-120b";
        }
      }
    }
  } catch {
    // Mantém fallback se a rota falhar
  }
}
loadAvailableModels();

// Sanitização básica contra XSS
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Renderizar Markdown em HTML completo (com suporte perfeito a tabelas, citações e listas)
function renderContent(rawText) {
  if (typeof window.marked !== "undefined" && typeof window.marked.parse === "function") {
    try {
      return window.marked.parse(rawText, { gfm: true, breaks: true });
    } catch {
      // Fallback simples se der erro
    }
  }
  return `<p>${escapeHtml(rawText).replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
}

// Aprimorar blocos de código adicionando cabeçalho escuro e botão de cópia
function enhanceCodeBlocks(container) {
  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.parentElement.classList.contains("code-container")) return;
    const codeEl = pre.querySelector("code");
    const rawCode = codeEl ? codeEl.innerText : pre.innerText;
    let lang = "código";
    if (codeEl) {
      for (const cls of codeEl.classList) {
        if (cls.startsWith("language-")) {
          lang = cls.replace("language-", "");
          break;
        }
      }
    }
    const wrapper = document.createElement("div");
    wrapper.className = "code-container";

    const header = document.createElement("div");
    header.className = "code-header";
    header.innerHTML = `
      <span class="code-lang">${escapeHtml(lang)}</span>
      <button type="button" class="copy-code-btn">📋 Copiar código</button>
    `;

    header.querySelector(".copy-code-btn").addEventListener("click", async () => {
      await navigator.clipboard.writeText(rawCode);
      const btn = header.querySelector(".copy-code-btn");
      btn.textContent = "✓ Copiado!";
      setTimeout(() => (btn.textContent = "📋 Copiar código"), 2000);
    });

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

// Criar elemento de mensagem na tela
function addMessage(role, content, options = {}) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2"/>
      </svg>
    `;
    article.append(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Se o usuário anexou imagem
  if (options.userImage) {
    const imgEl = document.createElement("img");
    imgEl.src = options.userImage;
    imgEl.className = "message-attachment-img";
    imgEl.alt = "Imagem anexada";
    bubble.append(imgEl);
  }

  // Se o usuário anexou documento
  if (options.docName) {
    const badge = document.createElement("div");
    badge.className = "doc-badge";
    badge.textContent = `📎 ${options.docName}`;
    bubble.append(badge);
  }

  // Se for imagem gerada
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
    // Markdown completo
    const mdContainer = document.createElement("div");
    mdContainer.className = "markdown-body";
    mdContainer.innerHTML = renderContent(content);
    enhanceCodeBlocks(mdContainer);
    bubble.append(mdContainer);

    // Barra de ações (Copiar, TXT, DOC, PDF) para respostas da IA
    if (role === "assistant") {
      const actionsBar = document.createElement("div");
      actionsBar.className = "message-actions-bar";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "action-pill-btn";
      copyBtn.textContent = "📋 Copiar";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(content);
        copyBtn.textContent = "✓ Copiado!";
        setTimeout(() => (copyBtn.textContent = "📋 Copiar"), 2000);
      });

      const downloadTxtBtn = document.createElement("button");
      downloadTxtBtn.type = "button";
      downloadTxtBtn.className = "action-pill-btn";
      downloadTxtBtn.textContent = "📄 .TXT";
      downloadTxtBtn.addEventListener("click", () => {
        downloadBlob(content, "resposta-ia.txt", "text/plain;charset=utf-8");
      });

      const downloadDocBtn = document.createElement("button");
      downloadDocBtn.type = "button";
      downloadDocBtn.className = "action-pill-btn";
      downloadDocBtn.textContent = "📝 .DOC";
      downloadDocBtn.addEventListener("click", () => {
        const docContent = `<html><head><meta charset="utf-8"></head><body>${renderContent(content)}</body></html>`;
        downloadBlob(docContent, "resposta-ia.doc", "application/msword;charset=utf-8");
      });

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

// Botão Novo Chat
if (newChatBtn) {
  newChatBtn.addEventListener("click", () => {
    conversation.length = 0;
    messagesContainer.innerHTML = "";
    addMessage("assistant", "Conversa reiniciada. Como posso ajudar você agora?");
    promptInput.value = "";
    currentAttachment = null;
    attachmentPreview.hidden = true;
    errorMessage.hidden = true;
    promptInput.focus();
  });
}

// Manipulação de Anexos
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
      const hasVision = Array.from(modelSelect.options).some((o) => o.value.includes("qwen"));
      if (hasVision) {
        modelSelect.value = "qwen/qwen3.8-27b";
      }
    };
    reader.readAsDataURL(file);
  } else {
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

  // Se o usuário pedir imagem explicitamente com /imagem
  if (prompt.toLowerCase().startsWith("/imagem ")) {
    const imagePrompt = prompt.replace(/^\/imagem\s*/i, "").trim();
    if (!imagePrompt) {
      errorMessage.textContent = "Digite o que você quer desenhar após /imagem.";
      errorMessage.hidden = false;
      return;
    }

    addMessage("user", prompt);
    sendButton.disabled = true;

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
      promptInput.focus();
    }
    return;
  }

  // FLUXO PRINCIPAL: Chat com a IA (Textos, Cálculos, Tabelas, Código, Documentos)
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

  const systemMessage = {
    role: "system",
    content: "Você é um assistente de inteligência artificial de ponta. Responda SEMPRE em português do Brasil com clareza, cordialidade e precisão. Use tabelas Markdown, blocos de código com linguagem e citações em destaque sempre que útil.",
  };

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelSelect.value,
        messages: [systemMessage, ...conversation],
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
    promptInput.focus();
  }
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

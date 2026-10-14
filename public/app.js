const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const messagesContainer = document.querySelector("#messages");
const sendButton = document.querySelector("#send");
const errorMessage = document.querySelector("#error");
const conversation = [];

function addMessage(role, content) {
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
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  bubble.append(paragraph);
  article.append(bubble);
  messagesContainer.append(article);
  article.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || sendButton.disabled) return;

  errorMessage.hidden = true;
  promptInput.value = "";
  promptInput.style.height = "auto";
  conversation.push({ role: "user", content: prompt });
  if (conversation.length > 20) conversation.splice(0, conversation.length - 20);
  addMessage("user", prompt);
  sendButton.disabled = true;
  sendButton.querySelector("span").textContent = "Enviando...";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation }),
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

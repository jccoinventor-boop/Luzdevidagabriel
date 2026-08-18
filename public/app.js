const WA = "527122466811";
const state = {
  step: 0,
  lead: {},
  sessionId: crypto.randomUUID(),
  attribution: Object.fromEntries(
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]
      .flatMap(key => {
        const value = new URLSearchParams(location.search).get(key)?.trim().slice(0, 120);
        return value ? [[key, value]] : [];
      })
  )
};

const flow = [
  { key: "name", ask: "Hola, soy el asistente de Gabriel. ¿Cómo te llamas?", validate: v => v.trim().length >= 2 },
  { key: "topic", ask: "Gracias, {name}. ¿Qué situación deseas revisar brevemente?", validate: v => v.trim().length >= 4 },
  { key: "priceAccepted", ask: "La consulta cuesta $100 MXN. ¿Estás de acuerdo con el precio?", choices: ["Sí, estoy de acuerdo", "Todavía no"], validate: v => /^(sí|si|acepto|de acuerdo|estoy de acuerdo)([,!. ]|$)/i.test(v) },
  { key: "modality", ask: "¿Qué modalidad prefieres?", choices: ["Teléfono", "Videollamada", "Presencial"], validate: v => /teléfono|telefono|video|presencial/i.test(v) },
  { key: "availability", ask: "Escribe una fecha y hora futura como DD/MM/AAAA HH:MM, usando 24 horas. Ejemplo: 22/08/2026 17:00.", validate: v => /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+([01]?\d|2[0-3]):([0-5]\d)$/.test(v.trim()) },
  { key: "phone", ask: "Escribe tu número de WhatsApp a 10 dígitos.", validate: v => v.replace(/\D/g, "").length === 10 },
  { key: "finalConfirmation", ask: "Para marcar tu solicitud como seria, confirma: SÍ CONFIRMO MI CITA. La cita seguirá pendiente hasta comprobar disponibilidad real.", choices: ["SÍ CONFIRMO MI CITA", "Todavía no"], validate: v => /^s[ií]\s+confirmo\s+mi\s+cita([,!. ]|$)/i.test(v) }
];

const dialog = document.querySelector("#chat");
const messages = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#chat-input");
const quick = document.querySelector("#quick-replies");

function interpolate(text) {
  return text.replace("{name}", state.lead.name || "");
}

function addMessage(text, type = "bot") {
  const item = document.createElement("div");
  item.className = `message ${type === "user" ? "user" : ""}`;
  item.textContent = text;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function ask() {
  const current = flow[state.step];
  addMessage(interpolate(current.ask));
  quick.replaceChildren();
  for (const choice of current.choices || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => answer(choice));
    quick.append(button);
  }
}

function track(event, extra = {}) {
  const payload = JSON.stringify({ event, sessionId: state.sessionId, at: new Date().toISOString(), attribution: state.attribution, ...extra });
  navigator.sendBeacon?.("/api/lead", new Blob([payload], { type: "application/json" })) || fetch("/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
}

async function answer(value) {
  const current = flow[state.step];
  addMessage(value, "user");
  if (!current.validate(value)) {
    if (current.key === "priceAccepted" || current.key === "finalConfirmation") {
      addMessage("Entiendo. No registraré una solicitud seria todavía. Cuando estés seguro/a, puedes volver a comenzar.");
      quick.replaceChildren();
      input.disabled = true;
      track("lead_not_qualified", { reason: current.key === "priceAccepted" ? "price_not_accepted" : "final_confirmation_missing" });
      return;
    }
    addMessage(current.key === "phone" ? "Necesito un número de 10 dígitos para que Gabriel pueda confirmar." : "¿Puedes darme un poco más de información?");
    return;
  }
  state.lead[current.key] = current.key === "phone" ? value.replace(/\D/g, "") : value.trim();
  state.step += 1;
  quick.replaceChildren();
  if (state.step < flow.length) return setTimeout(ask, 250);

  const validationMessages = [
    state.lead.name,
    state.lead.topic,
    "Sí, acepto",
    state.lead.modality,
    state.lead.availability,
    state.lead.finalConfirmation
  ].map(content => ({ role: "user", content }));
  let validation;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        messages: validationMessages,
        phone: state.lead.phone,
        attribution: state.attribution
      })
    });
    validation = response.ok ? await response.json() : null;
  } catch {
    validation = null;
  }

  if (!validation?.qualified) {
    addMessage("No pude registrar la solicitud de forma segura. Intenta enviarla de nuevo en unos minutos.");
    state.step -= 1;
    input.disabled = false;
    return;
  }

  const text = `Hola Gabriel, soy ${state.lead.name}. SÍ CONFIRMO MI CITA y acepto la consulta espiritual de $100 MXN. Tema: ${state.lead.topic}. Modalidad: ${state.lead.modality}. Horario preferido: ${state.lead.availability}. Mi WhatsApp: ${state.lead.phone}. Código: ${state.sessionId.slice(0, 8)}. Entiendo que el horario queda pendiente hasta comprobar disponibilidad real.`;
  addMessage("Tu solicitud seria está preparada. La cita queda pendiente hasta que se compruebe disponibilidad y Gabriel confirme fecha y hora por WhatsApp.");
  const link = document.createElement("a");
  link.className = "primary";
  link.href = `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Enviar solicitud confirmada a Gabriel";
  link.addEventListener("click", () => track("qualified_whatsapp_click"));
  messages.append(link);
  input.disabled = true;
}

function openChat() {
  if (!dialog.open) dialog.showModal();
  if (!messages.children.length) {
    track("chat_started");
    ask();
  }
  input.focus();
}

document.querySelectorAll("[data-open-chat]").forEach(el => el.addEventListener("click", openChat));
document.querySelector("[data-close-chat]").addEventListener("click", () => dialog.close());
form.addEventListener("submit", e => { e.preventDefault(); const value = input.value; input.value = ""; answer(value); });
document.querySelectorAll(".track-whatsapp").forEach(link => {
  const source = link.dataset.waSource;
  const text = `Hola Gabriel, quiero iniciar el proceso para una consulta espiritual de $100 MXN. Llegué desde: ${source}.`;
  link.href = `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.addEventListener("click", () => track("whatsapp_click", { source }));
});
document.querySelector("#year").textContent = new Date().getFullYear();
track("page_view");

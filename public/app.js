const WA = "527122466811";
const state = {
  step: 0,
  lead: {},
  sessionId: crypto.randomUUID(),
  attribution: Object.fromEntries(new URLSearchParams(location.search))
};

const flow = [
  { key: "name", ask: "Hola, soy el asistente de Gabriel. ¿Cómo te llamas?", validate: v => v.trim().length >= 2 },
  { key: "topic", ask: "Gracias, {name}. ¿Qué situación deseas revisar brevemente?", validate: v => v.trim().length >= 4 },
  { key: "priceAccepted", ask: "La consulta cuesta $100 MXN. ¿Estás de acuerdo con el precio?", choices: ["Sí, estoy de acuerdo", "Todavía no"], validate: v => /sí|si,|acuerdo/i.test(v) },
  { key: "modality", ask: "¿Qué modalidad prefieres?", choices: ["Teléfono", "Videollamada", "Presencial"], validate: v => /teléfono|telefono|video|presencial/i.test(v) },
  { key: "availability", ask: "¿Qué día y horario te funciona mejor? Gabriel confirmará la disponibilidad real por WhatsApp.", validate: v => v.trim().length >= 4 },
  { key: "phone", ask: "Por último, escribe tu número de WhatsApp a 10 dígitos.", validate: v => v.replace(/\D/g, "").length === 10 }
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
    if (current.key === "priceAccepted") {
      addMessage("Entiendo. No reservaré una cita todavía. Cuando estés de acuerdo con el costo, puedes volver a escribirnos.");
      quick.replaceChildren();
      input.disabled = true;
      track("lead_not_qualified", { reason: "price_not_accepted" });
      return;
    }
    addMessage(current.key === "phone" ? "Necesito un número de 10 dígitos para que Gabriel pueda confirmar." : "¿Puedes darme un poco más de información?");
    return;
  }
  state.lead[current.key] = current.key === "phone" ? value.replace(/\D/g, "") : value.trim();
  state.step += 1;
  quick.replaceChildren();
  if (state.step < flow.length) return setTimeout(ask, 250);

  const qualified = { ...state.lead, sessionId: state.sessionId, attribution: state.attribution, status: "qualified_pending_confirmation" };
  await fetch("/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "qualified_lead", ...qualified }) }).catch(() => {});
  const text = `Hola Gabriel, soy ${state.lead.name}. Quiero solicitar una consulta espiritual de $100 MXN. Tema: ${state.lead.topic}. Modalidad: ${state.lead.modality}. Horario preferido: ${state.lead.availability}. Mi WhatsApp: ${state.lead.phone}. Código: ${state.sessionId.slice(0, 8)}`;
  addMessage("Tu solicitud está preparada. La cita queda pendiente hasta que Gabriel confirme el horario por WhatsApp.");
  const link = document.createElement("a");
  link.className = "primary";
  link.href = `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Enviar solicitud a Gabriel";
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
  const text = `Hola Gabriel, quiero agendar una consulta espiritual de $100 MXN. Llegué desde: ${source}.`;
  link.href = `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.addEventListener("click", () => track("whatsapp_click", { source }));
});
document.querySelector("#year").textContent = new Date().getFullYear();
track("page_view");

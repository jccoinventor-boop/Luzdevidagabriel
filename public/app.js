const WA = "527122466811";
const PUBLIC_API = "https://bakcrmthmbbdnqmktfhy.supabase.co/functions/v1/gabriel-public-api";
const PUBLIC_API_KEY = "sb_publishable_91uUIn4MaVGlMscsRS9d-Q_7KzMF7SQ";
const PRIVACY_NOTICE_VERSION = "2026-08-31";
const futureAppointmentExample = () => {
  const target = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(target).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} 17:00`;
};
const state = {
  step: 0,
  lead: {},
  sessionId: crypto.randomUUID(),
  privacyAccepted: false,
  consentRecorded: false,
  submitting: false,
  telemetryStarted: false,
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
  { key: "availability", ask: `Escribe una fecha y hora futura como DD/MM/AAAA HH:MM, usando 24 horas. Ejemplo: ${futureAppointmentExample()}.`, validate: v => /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+([01]?\d|2[0-3]):([0-5]\d)$/.test(v.trim()) },
  { key: "phone", ask: "Escribe tu número de WhatsApp a 10 dígitos.", validate: v => v.replace(/\D/g, "").length === 10 },
  { key: "finalConfirmation", ask: "Para marcar tu solicitud como seria, confirma: SÍ CONFIRMO MI CITA. La cita seguirá pendiente hasta comprobar disponibilidad real.", choices: ["SÍ CONFIRMO MI CITA", "Todavía no"], validate: v => /^s[ií]\s+confirmo\s+mi\s+cita([,!. ]|$)/i.test(v) }
];

const dialog = document.querySelector("#chat");
const messages = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#chat-input");
const submit = form.querySelector("button[type='submit']");
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

function addPrivacyMessage() {
  const item = document.createElement("div");
  item.className = "message";
  item.append("Antes de continuar usaré tu nombre, WhatsApp, motivo general y horario para preparar la cita. Lee el ");
  const link = document.createElement("a");
  link.href = "/aviso-de-privacidad.html";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "aviso de privacidad";
  item.append(link, ". Sólo continuaré si aceptas.");
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function consentPayload() {
  return {
    accepted: state.privacyAccepted,
    noticeVersion: PRIVACY_NOTICE_VERSION
  };
}

async function publicRequest(payload, { keepalive = false } = {}) {
  const response = await fetch(PUBLIC_API, {
    method: "POST",
    headers: { apikey: PUBLIC_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Una respuesta sin JSON se trata como fallo y nunca confirma una cita.
  }
  return { ok: response.ok, status: response.status, body };
}

function setConsentButtonsDisabled(disabled) {
  quick.querySelectorAll("button").forEach(button => { button.disabled = disabled; });
}

function showConsentChoices() {
  quick.replaceChildren();
  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent = "Acepto y continuar";
  accept.addEventListener("click", acceptPrivacy);
  const decline = document.createElement("button");
  decline.type = "button";
  decline.textContent = "No acepto";
  decline.addEventListener("click", () => {
    addMessage("No acepto", "user");
    addMessage("De acuerdo. Sin tu autorización no recopilaré datos para la cita. Puedes cerrar esta ventana o aceptar después si cambias de opinión.");
    showConsentChoices();
  });
  quick.append(accept, decline);
}

async function acceptPrivacy() {
  setConsentButtonsDisabled(true);
  state.privacyAccepted = true;
  let result;
  try {
    result = await publicRequest({
      action: "consent",
      sessionId: state.sessionId,
      privacy: consentPayload()
    });
  } catch {
    result = null;
  }
  if (!result?.ok || result.body?.accepted !== true) {
    state.privacyAccepted = false;
    state.consentRecorded = false;
    addMessage("No pude registrar tu autorización de forma segura. No escribiré datos personales todavía; inténtalo nuevamente.");
    showConsentChoices();
    return;
  }
  state.consentRecorded = true;
  addMessage("Acepto el aviso de privacidad", "user");
  if (!state.telemetryStarted) {
    state.telemetryStarted = true;
    track("page_view");
    track("chat_started");
  }
  quick.replaceChildren();
  input.disabled = false;
  submit.disabled = false;
  input.placeholder = "Escribe tu respuesta…";
  ask();
  input.focus();
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
  if (!state.consentRecorded) return;
  const payload = JSON.stringify({ action: "lead", event, sessionId: state.sessionId, attribution: state.attribution, ...extra });
  fetch(PUBLIC_API, { method: "POST", headers: { apikey: PUBLIC_API_KEY, "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
}

async function answer(value) {
  if (!state.privacyAccepted || !state.consentRecorded || state.submitting) return;
  const current = flow[state.step];
  addMessage(value, "user");
  if (!current.validate(value)) {
    if (current.key === "priceAccepted" || current.key === "finalConfirmation") {
      addMessage("Entiendo. No registraré una solicitud seria todavía. Cuando estés seguro/a, puedes volver a comenzar.");
      quick.replaceChildren();
      input.disabled = true;
      submit.disabled = true;
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
  state.submitting = true;
  input.disabled = true;
  submit.disabled = true;

  const validationMessages = [
    state.lead.name,
    state.lead.topic,
    "Sí, acepto",
    state.lead.modality,
    state.lead.availability,
    state.lead.finalConfirmation
  ].map(content => ({ role: "user", content }));
  let validation;
  let validationStatus = 0;
  try {
    const result = await publicRequest({
      action: "chat",
      sessionId: state.sessionId,
      messages: validationMessages,
      phone: state.lead.phone,
      attribution: state.attribution,
      privacy: consentPayload()
    });
    validationStatus = result.status;
    validation = result.body;
  } catch {
    validation = null;
  }

  if (validationStatus === 409 && validation?.error === "slot_unavailable") {
    addMessage(validation.message || "Ese horario ya no está disponible. Elige otra fecha y hora.");
    state.step = flow.findIndex(item => item.key === "availability");
    delete state.lead.availability;
    delete state.lead.finalConfirmation;
    state.submitting = false;
    input.disabled = false;
    submit.disabled = false;
    return;
  }

  if (validationStatus < 200 || validationStatus >= 300 || !validation?.qualified) {
    addMessage("No pude registrar la solicitud de forma segura. Intenta enviarla de nuevo en unos minutos.");
    state.step -= 1;
    state.submitting = false;
    input.disabled = false;
    submit.disabled = false;
    return;
  }

  const bookingCode = validation.booking?.code || state.sessionId.slice(0, 8).toUpperCase();
  const hasHold = validation.booking?.status === "hold" || validation.state === "held";
  const text = hasHold
    ? `Hola Gabriel, soy ${state.lead.name}. Acepté el aviso de privacidad y la consulta espiritual de $100 MXN. El sistema apartó temporalmente el horario ${state.lead.availability}. Código: ${bookingCode}. Tema: ${state.lead.topic}. Modalidad: ${state.lead.modality}. Mi WhatsApp: ${state.lead.phone}. Entiendo que Gabriel todavía debe confirmar la cita.`
    : `Hola Gabriel, soy ${state.lead.name}. Acepté el aviso de privacidad y la consulta espiritual de $100 MXN. Tema: ${state.lead.topic}. Modalidad: ${state.lead.modality}. Horario preferido: ${state.lead.availability}. Mi WhatsApp: ${state.lead.phone}. Código: ${bookingCode}. Entiendo que el horario queda pendiente hasta comprobar disponibilidad real.`;
  addMessage(validation.message || "Tu solicitud quedó registrada y sigue pendiente de confirmación por Gabriel.");
  const link = document.createElement("a");
  link.className = "primary";
  link.href = `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Enviar solicitud confirmada a Gabriel";
  link.addEventListener("click", () => track("qualified_whatsapp_click"));
  messages.append(link);
  input.disabled = true;
  submit.disabled = true;
}

function openChat() {
  if (!dialog.open) dialog.showModal();
  if (!messages.children.length) {
    addPrivacyMessage();
    showConsentChoices();
  }
  if (state.privacyAccepted) input.focus();
}

document.querySelectorAll("[data-open-chat]").forEach(el => el.addEventListener("click", openChat));
document.querySelector("[data-close-chat]").addEventListener("click", () => dialog.close());
form.addEventListener("submit", e => { e.preventDefault(); const value = input.value; input.value = ""; answer(value); });
document.querySelectorAll(".track-whatsapp").forEach(link => {
  const source = link.dataset.waSource;
  const text = `Hola Gabriel, quiero iniciar el proceso para una consulta espiritual de $100 MXN. Antes de compartir datos, envíame el aviso de privacidad. Llegué desde: ${source}.`;
  link.href = `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.addEventListener("click", () => track("whatsapp_click", { source }));
});
document.querySelector("#year").textContent = new Date().getFullYear();

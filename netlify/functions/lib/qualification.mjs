const RISK_PATTERN = /\b(suicid|matarme|hacerme daño|hacer daño|violencia|amenaza|emergencia|secuestro|desaparecid[oa]|arma)\b/i;
const YES_PATTERN = /^(sí|si|acepto|de acuerdo|estoy de acuerdo|confirmo)([,!. ]|$)/i;
const NO_PATTERN = /^(no|todavía no|aún no|no acepto)([,!. ]|$)/i;

export const INITIAL_STATE = "awaiting_name";

export function normalizeText(value) {
  return String(value || "").trim().slice(0, 1000);
}

export function isRiskMessage(text) {
  return RISK_PATTERN.test(normalizeText(text));
}

export function isExplicitAcceptance(text) {
  return YES_PATTERN.test(normalizeText(text)) && !NO_PATTERN.test(normalizeText(text));
}

export function nextTurn(session = {}, rawText = "") {
  const text = normalizeText(rawText);
  const state = session.state || INITIAL_STATE;
  const lead = { ...(session.lead || {}) };

  if (isRiskMessage(text)) {
    return {
      state: "human_handoff",
      lead,
      qualified: false,
      handoff: true,
      reply: "Lo que describes requiere atención humana inmediata. Este asistente no puede atender emergencias. Contacta a los servicios de emergencia de tu localidad y, si es seguro hacerlo, avisa a una persona de confianza. También dejaré la conversación para revisión humana."
    };
  }

  if (state === "awaiting_name") {
    if (text.length < 2) return same(state, lead, "Escribe tu nombre para poder atenderte.");
    lead.name = text.slice(0, 100);
    return same("awaiting_topic", lead, `Gracias, ${lead.name}. Cuéntame brevemente qué situación deseas consultar.`);
  }

  if (state === "awaiting_topic") {
    if (text.length < 8) return same(state, lead, "Necesito una explicación breve de tu situación para saber si la consulta es adecuada.");
    lead.topic = text.slice(0, 500);
    return same("awaiting_price", lead, "La consulta cuesta $100 MXN. ¿Aceptas expresamente ese precio? Responde “Sí, acepto” o “No”.");
  }

  if (state === "awaiting_price") {
    if (NO_PATTERN.test(text)) {
      return { state: "not_qualified", lead: { ...lead, priceAccepted: false }, qualified: false, reply: "Entendido. No agendaré una cita. Si después decides aceptar el precio, puedes escribirnos nuevamente." };
    }
    if (!isExplicitAcceptance(text)) return same(state, lead, "Para continuar necesito una respuesta explícita: “Sí, acepto” o “No”.");
    lead.priceAccepted = true;
    return same("awaiting_modality", lead, "¿Cómo prefieres la consulta: teléfono, videollamada o presencial?");
  }

  if (state === "awaiting_modality") {
    const modality = /video/i.test(text) ? "Videollamada" : /presencial/i.test(text) ? "Presencial" : /tel[eé]fono|llamada/i.test(text) ? "Teléfono" : null;
    if (!modality) return same(state, lead, "Elige una modalidad: teléfono, videollamada o presencial.");
    lead.modality = modality;
    return same("awaiting_availability", lead, "Indica el día y horario que prefieres. Revisaré la disponibilidad antes de confirmar.");
  }

  if (state === "awaiting_availability") {
    if (text.length < 5) return same(state, lead, "Indica un día y una hora aproximada, por ejemplo: “jueves a las 5 pm”.");
    lead.availability = text.slice(0, 200);
    return {
      state: "qualified_pending_slot",
      lead,
      qualified: true,
      reply: "Gracias. Cumples los datos para solicitar una cita. Revisaremos ese horario; la cita sólo quedará confirmada cuando recibas fecha y hora definitivas."
    };
  }

  if (state === "qualified_pending_slot") {
    return same(state, lead, "Tu solicitud ya está registrada y pendiente de comprobar disponibilidad. Gabriel recibirá los datos de la conversación.");
  }

  if (state === "not_qualified") {
    if (/reiniciar|empezar|agendar/i.test(text)) return same(INITIAL_STATE, {}, "De acuerdo. Empecemos nuevamente: ¿cómo te llamas?");
    return same(state, lead, "No hay una cita activa. Escribe “agendar” si deseas comenzar otra vez.");
  }

  return { state: "human_handoff", lead, qualified: false, handoff: true, reply: "Voy a dejar esta conversación para que Gabriel la revise personalmente." };
}

function same(state, lead, reply) {
  return { state, lead, reply, qualified: false };
}

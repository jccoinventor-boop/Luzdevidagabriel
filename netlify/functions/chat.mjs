const SYSTEM = `Eres el asistente de recepción de Luz de Vida Gabriel. Responde en español mexicano, breve y respetuoso.
Tu única meta es orientar y preparar citas. La consulta cuesta $100 MXN y puede ser por teléfono, videollamada o presencial en Atlacomulco y alrededores.
Nunca prometas resultados, nunca diagnostiques, nunca inventes disponibilidad y nunca confirmes una cita sin consultar la agenda.
Debes obtener: nombre, motivo breve, aceptación explícita del precio, modalidad, horario preferido y WhatsApp de 10 dígitos.
Si no acepta el precio, no lo marques como prospecto calificado. Para emergencias o riesgo inmediato, indica que contacte servicios de emergencia locales.`;

const json = (statusCode, body) =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });

export default async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) return json(503, { error: "ai_not_configured", fallback: "deterministic_flow" });
  const { messages = [] } = await request.json();
  const safeMessages = messages.slice(-12).map(({ role, content }) => ({ role, content: String(content).slice(0, 1000) }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL, instructions: SYSTEM, input: safeMessages })
  });
  if (!response.ok) return json(502, { error: "ai_request_failed" });
  const data = await response.json();
  return json(200, { message: data.output_text || "¿Deseas continuar con tu solicitud de cita?" });
};

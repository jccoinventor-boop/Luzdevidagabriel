import { INITIAL_STATE, nextTurn } from "./lib/qualification.mjs";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

const initialTurn = () => ({
  state: INITIAL_STATE,
  lead: {},
  qualified: false,
  reply: "Hola, soy el asistente de Gabriel. ¿Cómo te llamas?"
});

export function replayConversation(messages = []) {
  let turn = initialTurn();
  for (const item of messages.slice(-12)) {
    if (item?.role !== "user") continue;
    turn = nextTurn(
      { state: turn.state, lead: turn.lead },
      String(item.content || "").slice(0, 1000)
    );
  }
  return turn;
}

export default async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    return json(422, { error: "messages_must_be_an_array" });
  }

  const turn = replayConversation(body.messages || []);
  return json(200, {
    message: turn.reply,
    state: turn.state,
    qualified: Boolean(turn.qualified),
    handoff: Boolean(turn.handoff)
  });
};

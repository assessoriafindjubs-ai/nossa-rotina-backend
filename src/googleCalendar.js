const { google } = require("googleapis");
const { getTokens, saveTokens } = require("./firestore");

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(profile) {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: profile,
  });
}

async function handleCallback(code, profile) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  await saveTokens(profile, tokens);
}

async function getAuthorizedClient(profile) {
  const tokens = await getTokens(profile);
  if (!tokens) return null;
  const client = newOAuthClient();
  client.setCredentials(tokens);
  client.on("tokens", (newTokens) => {
    saveTokens(profile, { ...tokens, ...newTokens }).catch((err) => console.error(err));
  });
  return client;
}

const GCAL_DAY = { dom: "SU", seg: "MO", ter: "TU", qua: "WE", qui: "TH", sex: "FR", sab: "SA" };
const GCAL_DAY_REVERSE = { SU: "dom", MO: "seg", TU: "ter", WE: "qua", TH: "qui", FR: "sex", SA: "sab" };
const WEEKDAY_BY_INDEX = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const APP_EVENT_MARKER = "Criado pelo app Nossa Rotina";

// Traduz a RRULE de um evento recorrente do Google Calendar para o formato { dias, horario } do app.
// Só reconhece recorrências diárias/semanais (o que o app consegue criar); o resto fica sem recorrência.
function parseRecurrence(event) {
  if (!event.recurrence || !event.start?.dateTime) return null;
  const rruleLine = event.recurrence.find((r) => r.startsWith("RRULE:"));
  if (!rruleLine) return null;
  const rule = Object.fromEntries(rruleLine.replace("RRULE:", "").split(";").map((p) => p.split("=")));
  const start = new Date(event.start.dateTime);
  const horario = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;

  if (rule.FREQ === "DAILY") {
    return { dias: [...WEEKDAY_BY_INDEX], horario };
  }
  if (rule.FREQ === "WEEKLY") {
    if (rule.BYDAY) {
      const dias = rule.BYDAY.split(",").map((d) => GCAL_DAY_REVERSE[d]).filter(Boolean);
      if (dias.length) return { dias, horario };
    }
    return { dias: [WEEKDAY_BY_INDEX[start.getDay()]], horario };
  }
  return null;
}

function buildEventBody(titulo, recorrencia) {
  const [hh, mm] = (recorrencia.horario || "19:00").split(":").map(Number);
  const start = new Date();
  start.setHours(hh, mm || 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60000);
  const byday = recorrencia.dias.map((d) => GCAL_DAY[d]).join(",");
  return {
    summary: titulo,
    description: APP_EVENT_MARKER,
    start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
    end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" },
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${byday}`],
  };
}

async function createEvent(profile, titulo, recorrencia) {
  const client = await getAuthorizedClient(profile);
  if (!client) return null;
  const calendar = google.calendar({ version: "v3", auth: client });
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: buildEventBody(titulo, recorrencia),
  });
  return res.data.id;
}

async function deleteEvent(profile, eventId) {
  const client = await getAuthorizedClient(profile);
  if (!client) return;
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    if (err.code !== 404 && err.code !== 410) throw err;
  }
}

async function listUpcomingEvents(profile) {
  const client = await getAuthorizedClient(profile);
  if (!client) return [];
  const calendar = google.calendar({ version: "v3", auth: client });
  const now = new Date();
  const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: false, // traz o evento "mestre" da recorrência, não uma cópia por ocorrência
    maxResults: 100,
  });
  return res.data.items || [];
}

module.exports = {
  getAuthUrl, handleCallback, createEvent, deleteEvent, listUpcomingEvents, parseRecurrence, APP_EVENT_MARKER,
};

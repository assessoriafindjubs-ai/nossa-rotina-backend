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
const APP_EVENT_MARKER = "Criado pelo app Nossa Rotina";

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
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  return res.data.items || [];
}

module.exports = { getAuthUrl, handleCallback, createEvent, deleteEvent, listUpcomingEvents, APP_EVENT_MARKER };

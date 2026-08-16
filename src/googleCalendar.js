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
const WEEKDAY_EN_TO_KEY = { Sun: "dom", Mon: "seg", Tue: "ter", Wed: "qua", Thu: "qui", Fri: "sex", Sat: "sab" };
const TIMEZONE = "America/Sao_Paulo";
const APP_EVENT_MARKER = "Criado pelo app Nossa Rotina";

// O servidor (Render) roda em UTC, não em horário de Brasília — por isso é preciso
// converter explicitamente pra America/Sao_Paulo em vez de usar getHours()/getDay() (hora local do servidor).
function timeInSaoPaulo(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === "hour").value.padStart(2, "0");
  const mm = parts.find((p) => p.type === "minute").value.padStart(2, "0");
  return `${hh === "24" ? "00" : hh}:${mm}`;
}

function weekdayInSaoPaulo(date) {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(date);
  return WEEKDAY_EN_TO_KEY[wd];
}

function todayDateInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date()); // YYYY-MM-DD
}

// Traduz a RRULE de um evento recorrente do Google Calendar para o formato { dias, horario } do app.
// Só reconhece recorrências diárias/semanais (o que o app consegue criar); o resto fica sem recorrência.
function parseRecurrence(event) {
  if (!event.recurrence || !event.start?.dateTime) return null;
  const rruleLine = event.recurrence.find((r) => r.startsWith("RRULE:"));
  if (!rruleLine) return null;
  const rule = Object.fromEntries(rruleLine.replace("RRULE:", "").split(";").map((p) => p.split("=")));
  const start = new Date(event.start.dateTime);
  const horario = timeInSaoPaulo(start);

  if (rule.FREQ === "DAILY") {
    return { dias: [...WEEKDAY_BY_INDEX], horario };
  }
  if (rule.FREQ === "WEEKLY") {
    if (rule.BYDAY) {
      const dias = rule.BYDAY.split(",").map((d) => GCAL_DAY_REVERSE[d]).filter(Boolean);
      if (dias.length) return { dias, horario };
    }
    return { dias: [weekdayInSaoPaulo(start)], horario };
  }
  return null;
}

function buildEventBody(titulo, recorrencia) {
  const horario = recorrencia.horario || "19:00";
  const [hh, mm] = horario.split(":").map(Number);
  const dataStr = todayDateInSaoPaulo();
  const endTotalMin = hh * 60 + (mm || 0) + 30;
  const endHora = `${String(Math.floor(endTotalMin / 60) % 24).padStart(2, "0")}:${String(endTotalMin % 60).padStart(2, "0")}`;
  const byday = recorrencia.dias.map((d) => GCAL_DAY[d]).join(",");
  return {
    summary: titulo,
    description: APP_EVENT_MARKER,
    start: { dateTime: `${dataStr}T${horario}:00-03:00`, timeZone: TIMEZONE },
    end: { dateTime: `${dataStr}T${endHora}:00-03:00`, timeZone: TIMEZONE },
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

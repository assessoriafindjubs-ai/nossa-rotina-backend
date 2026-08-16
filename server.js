require("dotenv").config();
const express = require("express");
const cors = require("cors");
const {
  getAuthUrl, handleCallback, createEvent, createSingleEvent, deleteEvent, listUpcomingEvents, parseRecurrence,
  APP_EVENT_MARKER,
} = require("./src/googleCalendar");
const { setTaskEventId, findTaskByGoogleEventId, createImportedTask, getImportedTasks } = require("./src/firestore");

const app = express();
app.use(cors());
app.use(express.json());

const FRONTEND_URL = process.env.FRONTEND_URL || "https://nossarotina.web.app";

app.get("/", (req, res) => res.send("Nossa Rotina — backend do Google Calendar no ar."));

app.get("/auth/google", (req, res) => {
  const profile = req.query.profile === "p2" ? "p2" : "p1";
  res.redirect(getAuthUrl(profile));
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const profile = state === "p2" ? "p2" : "p1";
  if (!code) {
    return res.redirect(`${FRONTEND_URL}?connect_error=1`);
  }
  try {
    await handleCallback(code, profile);
    res.redirect(`${FRONTEND_URL}?connected=${profile}`);
  } catch (err) {
    console.error(err);
    res.redirect(`${FRONTEND_URL}?connect_error=1`);
  }
});

app.post("/api/sync-task", async (req, res) => {
  const { taskId, titulo, dono, recorrencia, dataHora } = req.body || {};
  if (!taskId || !titulo || (!recorrencia?.dias?.length && !dataHora)) {
    return res.status(400).json({ error: "dados inválidos" });
  }
  const profiles = dono === "casal" ? ["p1", "p2"] : [dono];
  const results = {};
  for (const profile of profiles) {
    try {
      const eventId = recorrencia?.dias?.length
        ? await createEvent(profile, titulo, recorrencia)
        : await createSingleEvent(profile, titulo, dataHora);
      if (eventId) {
        await setTaskEventId(taskId, profile, eventId);
        results[profile] = eventId;
      }
    } catch (err) {
      console.error(`Erro ao criar evento para ${profile}:`, err.message);
    }
  }
  res.json({ ok: true, results });
});

app.delete("/api/sync-task", async (req, res) => {
  const { googleEventId } = req.body || {};
  if (googleEventId) {
    for (const [profile, eventId] of Object.entries(googleEventId)) {
      try {
        await deleteEvent(profile, eventId);
      } catch (err) {
        console.error(`Erro ao apagar evento de ${profile}:`, err.message);
      }
    }
  }
  res.json({ ok: true });
});

app.post("/api/import-calendar-events", async (req, res) => {
  const { profile } = req.body || {};
  if (profile !== "p1" && profile !== "p2") {
    return res.status(400).json({ error: "profile inválido" });
  }
  try {
    const events = (await listUpcomingEvents(profile)).filter(
      (e) => e.id && e.summary && e.description !== APP_EVENT_MARKER
    );
    const currentIds = new Set(events.map((e) => e.id));

    // remove tarefas importadas cujo evento não existe mais (ou virou obsoleto após a mudança
    // de "uma tarefa por ocorrência" para "uma tarefa por série recorrente")
    const existing = await getImportedTasks(profile);
    const removals = existing.filter((t) => !t.eventId || !currentIds.has(t.eventId));
    await Promise.all(removals.map((t) => t.ref.delete()));
    const stillPresentIds = new Set(existing.map((t) => t.eventId).filter((id) => currentIds.has(id)));

    let imported = 0;
    for (const event of events) {
      if (stillPresentIds.has(event.id)) continue;
      const recorrencia = parseRecurrence(event);
      await createImportedTask(profile, event, recorrencia);
      imported++;
    }
    res.json({ ok: true, imported, removed: removals.length });
  } catch (err) {
    console.error("Erro ao importar eventos:", err.message);
    res.status(500).json({ error: "falha ao importar" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { getAuthUrl, handleCallback, createEvent, deleteEvent } = require("./src/googleCalendar");
const { setTaskEventId } = require("./src/firestore");

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
  const { taskId, titulo, dono, recorrencia } = req.body || {};
  if (!taskId || !titulo || !recorrencia?.dias?.length) {
    return res.status(400).json({ error: "dados inválidos" });
  }
  const profiles = dono === "casal" ? ["p1", "p2"] : [dono];
  const results = {};
  for (const profile of profiles) {
    try {
      const eventId = await createEvent(profile, titulo, recorrencia);
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

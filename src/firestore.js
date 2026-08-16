const admin = require("firebase-admin");

let db = null;
function getDb() {
  if (!db) {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8")
    );
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    db = admin.firestore();
  }
  return db;
}

async function getTokens(profile) {
  const snap = await getDb().collection("casal_private").doc("google_tokens").get();
  const data = snap.exists ? snap.data() : {};
  return data[profile] || null;
}

async function saveTokens(profile, tokens) {
  await getDb().collection("casal_private").doc("google_tokens").set({ [profile]: tokens }, { merge: true });
  await getDb().collection("casal").doc("config").set({ googleConnected: { [profile]: true } }, { merge: true });
}

async function setTaskEventId(taskId, profile, eventId) {
  await getDb().collection("tarefas").doc(taskId).set({ googleEventId: { [profile]: eventId } }, { merge: true });
}

async function findTaskByGoogleEventId(profile, eventId) {
  const snap = await getDb()
    .collection("tarefas")
    .where(`googleEventId.${profile}`, "==", eventId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function getImportedTasks(profile) {
  const snap = await getDb()
    .collection("tarefas")
    .where("origem", "==", "google")
    .where("dono", "==", profile)
    .get();
  return snap.docs.map((d) => ({ ref: d.ref, eventId: d.data().googleEventId?.[profile] }));
}

async function createImportedTask(profile, event, recorrencia) {
  const dataHora = recorrencia ? null : event.start?.dateTime || event.start?.date || null;
  await getDb().collection("tarefas").add({
    titulo: event.summary || "(sem título)",
    dono: profile,
    prioridade: 2,
    concluida: false,
    origem: "google",
    dataHora,
    recorrencia: recorrencia || null,
    googleEventId: { [profile]: event.id },
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    concluidoEm: null,
  });
}

module.exports = {
  getTokens, saveTokens, setTaskEventId, findTaskByGoogleEventId, createImportedTask, getImportedTasks,
};

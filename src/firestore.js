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

module.exports = { getTokens, saveTokens, setTaskEventId };

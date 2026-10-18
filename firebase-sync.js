import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA9iZO7RenlzQjtG0LboBFdOo9zj0R-PYA",
  authDomain: "study-quest-20f97.firebaseapp.com",
  projectId: "study-quest-20f97",
  storageBucket: "study-quest-20f97.firebasestorage.app",
  messagingSenderId: "816674746718",
  appId: "1:816674746718:web:ed82b0464d85e1070b5fcf"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const KEYS = {
  state: "studyquest-v1",
  duration: "studyquestDuration",
  questions: "studyquest-own-questions-v1"
};

let currentUser = null;
let busy = false;
let cloudReady = false;
let lastSyncedSignature = null;
let pendingCloud = null;
let autoSaveTimer = null;

const $ = id => document.getElementById(id);

function readDeviceBundle() {
  return {
    state: localStorage.getItem(KEYS.state),
    duration: localStorage.getItem(KEYS.duration),
    questions: localStorage.getItem(KEYS.questions)
  };
}

function signature(data) {
  return JSON.stringify(data);
}

function status(message) {
  const el = $("sq-cloud-status");
  if (el) el.textContent = message;
}

function setBusy(value) {
  busy = value;
  [
    "sq-signin", "sq-register", "sq-sync-now", "sq-signout",
    "sq-use-cloud", "sq-use-device"
  ].forEach(id => {
    const el = $(id);
    if (el) el.disabled = value;
  });
}

function applyDeviceBundle(data) {
  Object.entries(KEYS).forEach(([name, storageKey]) => {
    if (data[name] === null || data[name] === undefined) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, data[name]);
    }
  });
}

function makePanel() {
  if ($("studyquest-cloud-account")) return;

  const panel = document.createElement("section");
  panel.id = "studyquest-cloud-account";
  panel.style.cssText =
    "max-width:520px;margin:18px auto;padding:16px;border-radius:16px;" +
    "background:#171923;color:#fff;font:14px Arial,sans-serif;" +
    "box-sizing:border-box;border:1px solid #444";

  panel.innerHTML = `
    <h3>☁️ StudyQuest Cloud Save</h3>
    <p id="sq-cloud-status">Sign in to back up your progress.</p>
    <div id="sq-auth-fields">
      <input id="sq-email" type="email" autocomplete="email"
        placeholder="Email address"
        style="box-sizing:border-box;width:100%;padding:12px;margin:5px 0">
      <input id="sq-password" type="password" autocomplete="current-password"
        placeholder="Password (at least 6 characters)"
        style="box-sizing:border-box;width:100%;padding:12px;margin:5px 0">
      <button id="sq-signin" type="button">Sign in</button>
      <button id="sq-register" type="button">Create account</button>
    </div>
    <div id="sq-signed-in" hidden>
      <p id="sq-account-email"></p>
      <button id="sq-sync-now" type="button">Check / sync now</button>
      <button id="sq-signout" type="button">Sign out</button>
    </div>
    <div id="sq-conflict" hidden
      style="margin-top:12px;padding:12px;border:1px solid #777;border-radius:10px">
      <p id="sq-conflict-message">
        Device and cloud data differ. Choose which version to keep.
      </p>
      <button id="sq-use-cloud" type="button">Use cloud data</button>
      <button id="sq-use-device" type="button">Keep this device's data</button>
    </div>
    <p style="font-size:12px;color:#aab3c5">
      If your data differs, choose carefully. Your password stays private.
    </p>`;
    const style = document.createElement("style");
  style.textContent =
    "#studyquest-cloud-account button{padding:10px 12px;border:0;" +
    "border-radius:8px;margin:4px;cursor:pointer;font-weight:600}" +
    "#studyquest-cloud-account button:disabled{opacity:.5}" +
    "#studyquest-cloud-account input{border-radius:8px;border:1px solid #888}";
  document.head.appendChild(style);
  document.body.appendChild(panel);
}

function showConflict(cloud, message) {
  pendingCloud = cloud;
  cloudReady = false;
  $("sq-conflict").hidden = false;
  $("sq-conflict-message").textContent = message;
  status("Your device and cloud have different data. Choose which to keep.");
}

async function fetchCloudBundle() {
  if (!currentUser) throw new Error("Please sign in again.");
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return data && data.studyQuestSync ? data.studyQuestSync : null;
}

async function writeCloudBundle(data) {
  if (!currentUser) throw new Error("Please sign in again.");
  await setDoc(doc(db, "users", currentUser.uid), {
    studyQuestSync: data,
    studyQuestSyncUpdatedAt: new Date().toISOString()
  }, { merge: true });
  lastSyncedSignature = signature(data);
}

async function syncNow() {
  if (!currentUser || busy) return;
  setBusy(true);
  cloudReady = false;
  $("sq-conflict").hidden = true;

  try {
    const device = readDeviceBundle();
    const cloud = await fetchCloudBundle();

    if (!cloud) {
      await writeCloudBundle(device);
      lastSyncedSignature = signature(device);
      cloudReady = true;
      status("✅ First cloud backup created from this device.");
      return;
    }

    const deviceSig = signature(device);
    const cloudSig = signature(cloud);

    if (deviceSig === cloudSig) {
      lastSyncedSignature = deviceSig;
      cloudReady = true;
      status("✅ Device and cloud data match.");
      return;
    }

    showConflict(
      cloud,
      "Device and cloud data are different. Choose which version to keep."
    );
  } catch (error) {
    status("Sync failed: " + (error?.message || "Unknown error"));
  } finally {
    setBusy(false);
  }
}
async function keepDeviceData() {
  if (!currentUser || busy) return;
  setBusy(true);
  cloudReady = false;

  try {
    const device = readDeviceBundle();
    const latestCloud = await fetchCloudBundle();

    if (
      latestCloud &&
      pendingCloud &&
      signature(latestCloud) !== signature(pendingCloud)
    ) {
      showConflict(
        latestCloud,
        "Cloud data changed again. Review the latest cloud version before choosing."
      );
      return;
    }

    await writeCloudBundle(device);
    pendingCloud = null;
    $("sq-conflict").hidden = true;
    lastSyncedSignature = signature(device);
    cloudReady = true;
    status("✅ This device's data is saved to the cloud.");
  } catch (error) {
    status("Cloud save failed: " + (error?.message || "Unknown error"));
  } finally {
    setBusy(false);
  }
}

function useCloudData() {
  if (!pendingCloud) return;

  try {
    applyDeviceBundle(pendingCloud);
    lastSyncedSignature = signature(readDeviceBundle());
    pendingCloud = null;
    $("sq-conflict").hidden = true;
    cloudReady = true;
    status("☁️ Cloud data loaded. Refreshing StudyQuest…");
    setTimeout(() => location.reload(), 500);
  } catch (error) {
    cloudReady = false;
    status("Could not apply cloud data: " + (error?.message || "Unknown error"));
  }
}

async function authenticate(createAccount) {
  const email = $("sq-email").value.trim();
  const password = $("sq-password").value;

  if (!email || !password) {
    status("Enter your email address and password.");
    return;
  }
  if (password.length < 6) {
    status("Password must be at least 6 characters.");
    return;
  }

  setBusy(true);
  try {
    if (createAccount) {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    status(error?.message || "Could not sign in.");
  } finally {
    setBusy(false);
  }
}
function startAutoSave() {
  if (autoSaveTimer) clearInterval(autoSaveTimer);

  autoSaveTimer = setInterval(async () => {
    if (!currentUser || !cloudReady || busy) return;

    const device = readDeviceBundle();
    const deviceSig = signature(device);
    if (deviceSig === lastSyncedSignature) return;

    busy = true;
    try {
      const cloud = await fetchCloudBundle();

      if (cloud && signature(cloud) !== lastSyncedSignature) {
        showConflict(
          cloud,
          "Cloud data may have changed on another device. Choose which version to keep."
        );
        return;
      }

      await writeCloudBundle(device);
      lastSyncedSignature = deviceSig;
      status("✅ Progress saved to your cloud account.");
    } catch (error) {
      status("Cloud save failed: " + (error?.message || "Try Check / sync now."));
    } finally {
      busy = false;
    }
  }, 10000);
}

makePanel();

$("sq-signin").onclick = () => authenticate(false);
$("sq-register").onclick = () => authenticate(true);
$("sq-sync-now").onclick = syncNow;
$("sq-use-cloud").onclick = useCloudData;
$("sq-use-device").onclick = keepDeviceData;

$("sq-signout").onclick = async () => {
  cloudReady = false;
  pendingCloud = null;
  $("sq-conflict").hidden = true;

  try {
    await signOut(auth);
  } catch (error) {
    status("Sign-out failed: " + (error?.message || "Unknown error"));
  }
};

onAuthStateChanged(auth, async user => {
  currentUser = user;
  cloudReady = false;
  pendingCloud = null;
  $("sq-auth-fields").hidden = !!user;
  $("sq-signed-in").hidden = !user;
  $("sq-conflict").hidden = true;

  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }

  if (!user) {
    status("Sign in to back up your progress.");
    return;
  }

  $("sq-account-email").textContent = "Signed in as " + (user.email || "");
  status("Checking cloud backup…");
  await syncNow();

  if (cloudReady) startAutoSave();
});

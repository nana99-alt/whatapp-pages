const $ = (id) => document.getElementById(id);
const cfg = window.WHATAPP_CONFIG || {};
let supabase = null;
let currentUser = null;
let activeChat = null;
let realtimeChannel = null;
let people = [];
let callMode = "voice";
let deferredInstallPrompt = null;
let currentVirtualNumber = null;
let peerConnection = null;
let localStream = null;
let callChannel = null;
let currentCallId = null;
let pendingIncomingCall = null;
let pushReady = false;

const demoPeople = [
  { id: "demo-sarah", name: "Sarah", avatar: "👩🏻", preview: "Aku baik juga 😊", time: "09.42", unread: 2, status: "online", demo: true },
  { id: "demo-rizky", name: "Rizky", avatar: "🧑🏽", preview: "Oke, sampai nanti!", time: "08.15", unread: 0, status: "terakhir dilihat 08.15", demo: true },
  { id: "demo-nadia", name: "Nadia", avatar: "👩🏼", preview: "Foto sudah aku kirim", time: "Kemarin", unread: 0, status: "online", demo: true },
  { id: "demo-andi", name: "Andi", avatar: "👨🏻", preview: "Terima kasih banyak", time: "Kemarin", unread: 0, status: "terakhir dilihat kemarin", demo: true }
];

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function showPage(page) {
  ["chatsPage", "updatesPage", "callsPage", "conversationPage"].forEach((id) => $(id).classList.add("hidden"));
  $(page).classList.remove("hidden");
}
function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
}
function renderChats(filter = "") {
  const list = $("chatList");
  list.innerHTML = "";
  const query = filter.toLowerCase();
  people.filter((p) => `${p.name} ${p.virtual_number || ""} ${p.preview || ""}`.toLowerCase().includes(query)).forEach((p) => {
    const row = document.createElement("div");
    row.className = "chat-item";
    row.innerHTML = '<div class="avatar"></div><div class="chat-copy"><div class="chat-line"><b></b><time></time></div><div class="chat-line"><div class="chat-preview"></div></div></div>';
    row.querySelector(".avatar").textContent = p.avatar || "🙂";
    row.querySelector("b").textContent = p.name;
    row.querySelector("time").textContent = p.time || "";
    row.querySelector(".chat-preview").textContent = p.preview || "Mulai percakapan baru";
    if (p.unread) {
      const badge = document.createElement("span");
      badge.className = "unread";
      badge.textContent = p.unread;
      row.querySelector(".chat-line:last-child").appendChild(badge);
    }
    row.addEventListener("click", () => openChat(p));
    list.appendChild(row);
  });
  if (!list.children.length) list.innerHTML = '<p class="hint">Kontak tidak ditemukan.</p>';
}
function renderMessages(messages = []) {
  const container = $("messages");
  container.innerHTML = '<div class="date-chip">OBROLAN</div>';
  messages.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.sender_id === currentUser?.id ? "sent" : "received"}`;
    if (message.body) bubble.appendChild(document.createTextNode(message.body));
    if (message.attachment_url) {
      const link = document.createElement("a");
      link.href = message.attachment_url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = message.attachment_type?.startsWith("image/") ? "Lihat gambar" : "Buka lampiran";
      bubble.appendChild(link);
    }
    const meta = document.createElement("span");
    meta.textContent = formatTime(message.created_at) || "sekarang";
    bubble.appendChild(meta);
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}
async function loadMessages() {
  if (!supabase || !currentUser || !activeChat) return;
  if (activeChat.demo) {
    renderMessages([
      { sender_id: activeChat.id, body: "Hai! Apa kabar?", created_at: new Date().toISOString() },
      { sender_id: currentUser.id, body: "Mode demo aktif — hubungkan Supabase untuk mengirim pesan.", created_at: new Date().toISOString() }
    ]);
    return;
  }
  const { data, error } = await supabase.from("messages").select("id,sender_id,receiver_id,body,attachment_url,attachment_type,created_at,read_at").or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},receiver_id.eq.${currentUser.id})`).order("created_at", { ascending: true }).limit(200);
  if (error) return toast(error.message);
  renderMessages(data || []);
}
function subscribeToMessages() {
  if (!supabase || !currentUser) return;
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase.channel(`messages:${currentUser.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
    const message = payload.new;
    if (activeChat && (message.sender_id === activeChat.id || message.receiver_id === activeChat.id)) loadMessages();
    const person = people.find((p) => p.id === message.sender_id || p.id === message.receiver_id);
    if (person) { person.preview = message.body || "Lampiran"; person.time = formatTime(message.created_at); renderChats($("filterChats").value); }
  }).subscribe();
}
async function openChat(person) {
  activeChat = person;
  $("activeName").textContent = person.name;
  $("activeAvatar").textContent = person.avatar || "🙂";
  $("activeStatus").textContent = person.status || "offline";
  showPage("conversationPage");
  await loadMessages();
}
async function sendMessage(text, file = null) {
  if (!text.trim() && !file) return;
  if (!supabase || !currentUser || !activeChat || activeChat.demo) {
    if (activeChat?.demo) toast("Mode demo tidak menyimpan pesan. Hubungkan Supabase terlebih dahulu.");
    return;
  }
  let attachment_url = null;
  let attachment_type = null;
  if (file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${currentUser.id}/${Date.now()}-${safeName}`;
    const upload = await supabase.storage.from("chat-media").upload(path, file, { upsert: false, contentType: file.type });
    if (upload.error) return toast(upload.error.message);
    attachment_url = supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl;
    attachment_type = file.type;
  }
  const { error } = await supabase.from("messages").insert({ sender_id: currentUser.id, receiver_id: activeChat.id, body: text.trim() || "", attachment_url, attachment_type });
  if (error) return toast(error.message);
  $("messageInput").value = "";
  $("fileInput").value = "";
}
function waitForIce(pc) { return new Promise((resolve) => { if (pc.iceGatheringState === "complete") return resolve(); const done = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", done); resolve(); } }; pc.addEventListener("icegatheringstatechange", done); setTimeout(resolve, 5000); }); }
function showCallScreen(mode, person) {
  callMode = mode;
  $("callTypeLabel").textContent = mode === "video" ? "Panggilan video" : "Panggilan suara";
  $("callerName").textContent = person?.name || "Pengguna";
  $("callerAvatar").textContent = person?.avatar || "👤";
  $("callStatus").textContent = "Menghubungkan...";
  $("callScreen").classList.remove("hidden");
  $("mainScreen").classList.add("hidden");
}
async function preparePeer(mode, person) {
  if (!supabase || !currentUser || !person || person.demo) return null;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
  $("localVideo").srcObject = localStream;
  $("localVideo").classList.toggle("hidden", mode !== "video");
  peerConnection = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = (event) => { $("remoteVideo").srcObject = event.streams[0]; $("remoteVideo").classList.toggle("hidden", mode !== "video"); $("callerAvatar").classList.add("hidden"); };
  peerConnection.onconnectionstatechange = () => { if (["connected", "completed"].includes(peerConnection.connectionState)) $("callStatus").textContent = "Terhubung"; };
  currentCallId = crypto.randomUUID();
  callChannel = supabase.channel(`call:${currentCallId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals", filter: `call_id=eq.${currentCallId}` }, async ({ new: signal }) => {
    if (signal.receiver_id !== currentUser.id) return;
    if (signal.kind === "answer" && peerConnection.signalingState !== "stable") await peerConnection.setRemoteDescription(signal.payload);
    if (signal.kind === "hangup") endCall(false);
  }).subscribe();
  return peerConnection;
}
async function startCall(mode) {
  if (!activeChat || activeChat.demo) return toast("Pilih pengguna yang sudah terdaftar untuk menelepon.");
  try {
    showCallScreen(mode, activeChat);
    const pc = await preparePeer(mode, activeChat);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);
    const { error } = await supabase.from("call_signals").insert({ call_id: currentCallId, sender_id: currentUser.id, receiver_id: activeChat.id, kind: "offer", payload: { ...pc.localDescription, mode } });
    if (error) throw error;
    $("callStatus").textContent = "Menunggu jawaban...";
  } catch (error) { toast(error.message || "Kamera/mikrofon tidak tersedia"); endCall(false); }
}
function endCall(notify = true) {
  if (supabase && currentCallId && currentUser && activeChat && notify) supabase.from("call_signals").insert({ call_id: currentCallId, sender_id: currentUser.id, receiver_id: activeChat.id, kind: "hangup", payload: {} });
  localStream?.getTracks().forEach((track) => track.stop());
  if (callChannel && supabase) supabase.removeChannel(callChannel);
  peerConnection?.close(); peerConnection = null; localStream = null; callChannel = null; currentCallId = null;
  $("remoteVideo").srcObject = null; $("localVideo").srcObject = null;
  $("remoteVideo").classList.add("hidden"); $("localVideo").classList.add("hidden"); $("callerAvatar").classList.remove("hidden");
  $("callScreen").classList.add("hidden"); $("mainScreen").classList.remove("hidden"); if (notify) toast("Panggilan diakhiri");
}
async function acceptIncomingCall() {
  const signal = pendingIncomingCall;
  if (!signal) return;
  pendingIncomingCall = null;
  $("incomingScreen").classList.add("hidden");
  activeChat = people.find((person) => person.id === signal.sender_id) || { id: signal.sender_id, name: "Pengguna", avatar: "👤" };
  try {
    showCallScreen(signal.payload?.mode || "voice", activeChat);
    currentCallId = signal.call_id;
    const pc = await preparePeer(signal.payload?.mode || "voice", activeChat);
    await pc.setRemoteDescription(signal.payload);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);
    const { error } = await supabase.from("call_signals").insert({ call_id: currentCallId, sender_id: currentUser.id, receiver_id: signal.sender_id, kind: "answer", payload: pc.localDescription });
    if (error) throw error;
    $("callStatus").textContent = "Terhubung";
  } catch (error) { toast(error.message || "Panggilan gagal diterima"); endCall(false); }
}
function subscribeToCalls() {
  if (!supabase || !currentUser) return;
  supabase.channel(`incoming-calls:${currentUser.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals", filter: `receiver_id=eq.${currentUser.id}` }, ({ new: signal }) => {
    if (signal.kind !== "offer" || pendingIncomingCall) return;
    pendingIncomingCall = signal;
    $("incomingKind").textContent = signal.payload?.mode === "video" ? "Panggilan video WhatApp" : "Panggilan suara WhatApp";
    $("incomingScreen").classList.remove("hidden");
  }).subscribe();
}
window.addEventListener("nativeIncomingCall", async (event) => {
  const detail = event.detail || {};
  if (!supabase || !currentUser || !detail.call_id) return;
  const { data } = await supabase.from("call_signals").select("call_id,sender_id,receiver_id,kind,payload").eq("call_id", detail.call_id).eq("kind", "offer").limit(1).maybeSingle();
  if (!data) return;
  pendingIncomingCall = data;
  $("incomingKind").textContent = detail.mode === "video" ? "Panggilan video WhatApp" : "Panggilan suara WhatApp";
  $("incomingScreen").classList.remove("hidden");
});
async function setupNativePush() {
  if (pushReady || !supabase || !currentUser) return;
  const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
  if (!PushNotifications) return;
  pushReady = true;
  await PushNotifications.addListener("registration", async (token) => {
    const { error } = await supabase.from("call_fcm_tokens").upsert({ token: token.value, user_id: currentUser.id, platform: "android", updated_at: new Date().toISOString() }, { onConflict: "token" });
    if (error) console.warn("FCM token sync failed", error.message);
  });
  await PushNotifications.addListener("registrationError", (error) => console.warn("FCM registration failed", error));
  await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const callId = notification?.data?.call_id;
    showPage("callsPage");
    if (callId) toast("Membuka panggilan masuk...");
  });
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive === "granted") await PushNotifications.register();
}
async function ensureProfile() {
  if (!supabase || !currentUser) return;
  const name = currentUser.user_metadata?.display_name || currentUser.email?.split("@")[0] || "Pengguna";
  const existing = await supabase.from("profiles").select("virtual_number").eq("id", currentUser.id).maybeSingle();
  let virtual_number = existing.data?.virtual_number;
  if (!virtual_number) {
    for (let attempt = 0; attempt < 5 && !virtual_number; attempt += 1) {
      const candidate = `WA-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
      const taken = await supabase.from("profiles").select("id").eq("virtual_number", candidate).maybeSingle();
      if (!taken.data) virtual_number = candidate;
    }
  }
  const saved = await supabase.from("profiles").upsert({ id: currentUser.id, display_name: name, virtual_number }, { onConflict: "id" }).select("virtual_number").single();
  currentVirtualNumber = saved.data?.virtual_number || virtual_number;
  if ($("myNumber") && currentVirtualNumber) $("myNumber").textContent = `Nomor Anda: ${currentVirtualNumber}`;
}
async function loadPeople() {
  if (!supabase || !currentUser) { people = demoPeople; renderChats(); return; }
  const { data, error } = await supabase.from("profiles").select("id,display_name,avatar_url,virtual_number").neq("id", currentUser.id).order("display_name").limit(100);
  if (error) return toast(error.message);
  people = (data || []).map((p) => ({ id: p.id, name: p.display_name, avatar: p.avatar_url || "🙂", virtual_number: p.virtual_number, preview: p.virtual_number || "Mulai percakapan baru", status: "tersedia" }));
  renderChats();
}
async function initSupabase() {
  const ready = cfg.SUPABASE_URL?.startsWith("https://") && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
  if (!ready) { people = demoPeople; renderChats(); $("authScreen").classList.remove("hidden"); return; }
  supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user || null;
  $("authScreen").classList.toggle("hidden", !!currentUser);
  if (currentUser) { await ensureProfile(); await loadPeople(); subscribeToMessages(); subscribeToCalls(); await setupNativePush(); toast(`Nomor Anda: ${currentVirtualNumber}`); }
  supabase.auth.onAuthStateChange(async (_event, nextSession) => {
    currentUser = nextSession?.user || null;
    $("authScreen").classList.toggle("hidden", !!currentUser);
    if (currentUser) { pushReady = false; await ensureProfile(); await loadPeople(); subscribeToMessages(); subscribeToCalls(); await setupNativePush(); toast(`Nomor Anda: ${currentVirtualNumber}`); }
  });
}
async function auth(signup) {
  if (!supabase) { $("authMessage").textContent = "Isi secret Supabase melalui www/config.js atau GitHub Actions terlebih dahulu."; return; }
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || password.length < 6) { $("authMessage").textContent = "Masukkan email dan kata sandi minimal 6 karakter."; return; }
  const result = signup ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }) : await supabase.auth.signInWithPassword({ email, password });
  $("authMessage").textContent = result.error ? result.error.message : (signup ? "Periksa email untuk verifikasi akun." : "Berhasil masuk.");
}

document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => { document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active")); btn.classList.add("active"); showPage({ chats: "chatsPage", updates: "updatesPage", calls: "callsPage" }[btn.dataset.tab]); }));
$("filterChats").addEventListener("input", (e) => renderChats(e.target.value));
$("backBtn").onclick = () => { showPage("chatsPage"); document.querySelector('[data-tab="chats"]').click(); };
$("sendBtn").onclick = () => sendMessage($("messageInput").value);
$("messageInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(e.target.value); });
$("voiceCallBtn").onclick = () => startCall("voice");
$("videoCallBtn").onclick = () => startCall("video");
$("endCallBtn").onclick = endCall;
$("minimizeCall").onclick = endCall;
$("acceptBtn").onclick = acceptIncomingCall;
$("declineBtn").onclick = () => { pendingIncomingCall = null; $("incomingScreen").classList.add("hidden"); };
$("muteBtn").onclick = () => toast("Kontrol mikrofon aktif setelah WebRTC diintegrasikan.");
$("speakerBtn").onclick = () => toast("Kontrol speaker tersedia pada panggilan WebRTC native.");
$("videoToggle").onclick = () => { callMode = "video"; $("callTypeLabel").textContent = "Panggilan video"; toast("Kamera perlu integrasi WebRTC."); };
$("attachBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = (e) => { const file = e.target.files[0]; if (file) sendMessage("", file); };
$("newChatBtn").onclick = $("composeBtn").onclick = () => { $("filterChats").focus(); toast("Cari pengguna dari daftar profil."); };
$("startCallFromList").onclick = () => startCall("voice");
document.querySelectorAll("[data-call]").forEach((b) => b.onclick = () => startCall(b.dataset.call));
$("menuBtn").onclick = async () => { if (supabase && currentUser) { await supabase.auth.signOut(); toast("Anda telah keluar"); } else toast("Hubungkan Supabase untuk menu akun."); };
$("searchBtn").onclick = () => $("filterChats").focus();
$("demoBtn").onclick = () => { $("authScreen").classList.add("hidden"); people = demoPeople; renderChats(); toast("Mode demo aktif"); };
$("loginBtn").onclick = () => auth(false);
$("signupBtn").onclick = () => auth(true);

document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => { if (btn.dataset.tab === "chats") renderChats($("filterChats").value); }));

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("installBtn").classList.remove("hidden");
});
$("installBtn").onclick = async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("installBtn").classList.add("hidden");
};
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $("installBtn").classList.add("hidden");
  toast("WhatApp berhasil dipasang");
});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

renderChats();
initSupabase();

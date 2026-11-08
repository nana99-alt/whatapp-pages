const $ = (id) => document.getElementById(id);
const cfg = window.WHATAPP_CONFIG || {};
const DEMO_STORAGE_KEY = "whatapp-demo-v2";
let supabase = null;
let currentUser = null;
let activeChat = null;
let realtimeChannel = null;
let people = [];
let deferredInstallPrompt = null;
let currentVirtualNumber = null;
const demoPeople = [
  { id: "demo-sarah", name: "Sarah", avatar: "👩🏻", preview: "Aku baik juga 😊", time: "09.42", unread: 2, status: "online", demo: true },
  { id: "demo-rizky", name: "Rizky", avatar: "🧑🏽", preview: "Oke, sampai nanti!", time: "08.15", unread: 0, status: "terakhir dilihat 08.15", demo: true },
  { id: "demo-nadia", name: "Nadia", avatar: "👩🏼", preview: "Foto sudah aku kirim", time: "Kemarin", unread: 0, status: "online", demo: true },
  { id: "demo-andi", name: "Andi", avatar: "👨🏻", preview: "Terima kasih banyak", time: "Kemarin", unread: 0, status: "terakhir dilihat kemarin", demo: true }
];
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
}
function showPage(page) {
  ["chatsPage", "updatesPage", "callsPage", "conversationPage"].forEach((id) => $(id).classList.add("hidden"));
  $(page).classList.remove("hidden");
}
function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
}
function readDemoData() {
  try { return JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveDemoData(data) {
  try { localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data)); }
  catch { toast("Penyimpanan lokal penuh; pesan demo tidak dapat disimpan."); }
}
function getDemoMessages(person) {
  const stored = readDemoData();
  if (stored.messages?.[person.id]) return stored.messages[person.id];
  const now = Date.now();
  if (person.id === "demo-sarah") return [
    { id: "sample-1", sender_id: person.id, body: "Hai! Apa kabar?", created_at: new Date(now - 120000).toISOString() },
    { id: "sample-2", sender_id: "demo-me", body: "Baik, kamu bagaimana?", created_at: new Date(now - 60000).toISOString() },
    { id: "sample-3", sender_id: person.id, body: "Aku baik juga 😊", created_at: new Date(now).toISOString() }
  ];
  return [];
}
function renderChats(filter = "") {
  const list = $("chatList"); list.innerHTML = "";
  const query = filter.toLowerCase().trim();
  const filtered = people.filter((p) => `${p.name} ${p.virtual_number || ""} ${p.preview || ""}`.toLowerCase().includes(query));
  filtered.forEach((p) => {
    const row = document.createElement("button"); row.type = "button"; row.className = "chat-item";
    row.setAttribute("aria-label", `Buka obrolan dengan ${p.name}`);
    row.innerHTML = '<div class="avatar"></div><div class="chat-copy"><div class="chat-line"><b></b><time></time></div><div class="chat-line"><div class="chat-preview"></div></div></div>';
    row.querySelector(".avatar").textContent = p.avatar || "🙂";
    row.querySelector("b").textContent = p.name;
    row.querySelector("time").textContent = p.time || "";
    row.querySelector(".chat-preview").textContent = p.preview || "Mulai percakapan baru";
    if (p.unread) { const badge = document.createElement("span"); badge.className = "unread"; badge.textContent = p.unread; row.querySelector(".chat-line:last-child").appendChild(badge); }
    row.addEventListener("click", () => openChat(p)); list.appendChild(row);
  });
  if (!filtered.length) {
    const empty = document.createElement("p"); empty.className = "hint empty-state";
    empty.textContent = query ? "Kontak tidak ditemukan. Coba cari nama atau ID WhatApp." : "Belum ada obrolan. Ketuk + untuk memulai percakapan.";
    list.appendChild(empty);
  }
}
function renderMessages(messages = []) {
  const container = $("messages"); container.innerHTML = '<div class="date-chip">OBROLAN</div>';
  messages.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.sender_id === currentUser?.id || message.sender_id === "demo-me" ? "sent" : "received"}`;
    if (message.body) bubble.appendChild(document.createTextNode(message.body));
    if (message.attachment_url) {
      const link = document.createElement("a"); link.href = message.attachment_url; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = message.attachment_type?.startsWith("image/") ? "Lihat gambar" : "Buka lampiran"; bubble.appendChild(link);
    }
    const meta = document.createElement("span"); meta.textContent = formatTime(message.created_at) || "sekarang";
    bubble.appendChild(meta); container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}
async function loadMessages() {
  if (activeChat?.demo) return renderMessages(getDemoMessages(activeChat));
  if (!supabase || !currentUser || !activeChat) return renderMessages([]);
  const { data, error } = await supabase.from("messages").select("id,sender_id,receiver_id,body,attachment_url,attachment_type,created_at,read_at").or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},receiver_id.eq.${currentUser.id})`).order("created_at", { ascending: true }).limit(200);
  if (error) return toast(`Pesan gagal dimuat: ${error.message}`);
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
  activeChat = person; person.unread = 0;
  $("activeName").textContent = person.name; $("activeAvatar").textContent = person.avatar || "🙂";
  $("activeStatus").textContent = person.status || "tersedia"; showPage("conversationPage");
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "chats"));
  await loadMessages();
}
async function sendMessage(text, file = null) {
  const body = text.trim(); if (!body && !file) return;
  if (!activeChat) return toast("Pilih kontak terlebih dahulu.");
  if (activeChat.demo || !supabase || !currentUser) {
    const data = readDemoData(); data.messages ||= {}; data.messages[activeChat.id] ||= getDemoMessages(activeChat);
    data.messages[activeChat.id].push({ id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()), sender_id: "demo-me", body, created_at: new Date().toISOString() });
    activeChat.preview = body || "Lampiran"; activeChat.time = formatTime(new Date()); saveDemoData(data);
    $("messageInput").value = ""; renderMessages(data.messages[activeChat.id]); renderChats($("filterChats").value);
    if (file) toast("Lampiran hanya tersedia setelah akun dan penyimpanan tersambung.");
    return;
  }
  let attachment_url = null; let attachment_type = null;
  if (file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${currentUser.id}/${Date.now()}-${safeName}`;
    const upload = await supabase.storage.from("chat-media").upload(path, file, { upsert: false, contentType: file.type });
    if (upload.error) return toast(`Lampiran gagal diunggah: ${upload.error.message}`);
    attachment_url = supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl; attachment_type = file.type;
  }
  const { error } = await supabase.from("messages").insert({ sender_id: currentUser.id, receiver_id: activeChat.id, body, attachment_url, attachment_type });
  if (error) return toast(`Pesan gagal dikirim: ${error.message}`);
  $("messageInput").value = ""; $("fileInput").value = ""; await loadMessages();
}
function startCall() { toast("Panggilan suara/video belum aktif: signaling WebRTC dan TURN server belum dikonfigurasi."); }
function createVirtualId() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  const part = (value) => String(value % 9000 + 1000);
  return `WA-${part(bytes[0])}-${part(bytes[1])}`;
}
async function ensureProfile() {
  if (!supabase || !currentUser) return;
  const name = currentUser.user_metadata?.display_name || currentUser.email?.split("@")[0] || "Pengguna";
  const existing = await supabase.from("profiles").select("virtual_number").eq("id", currentUser.id).maybeSingle();
  if (existing.error) return toast(`Profil gagal dibaca: ${existing.error.message}`);
  const existingId = existing.data?.virtual_number || null;
  let saved = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = existingId || createVirtualId();
    saved = await supabase.from("profiles").upsert(
      { id: currentUser.id, display_name: name, virtual_number: candidate },
      { onConflict: "id" }
    ).select("virtual_number").single();
    if (!saved.error) break;
    // Unique constraint virtual_number is the final authority under concurrent sign-ups.
    if (existingId || saved.error.code !== "23505") break;
  }
  if (saved?.error) return toast(`ID kontak gagal dibuat: ${saved.error.message}`);
  currentVirtualNumber = saved?.data?.virtual_number || null;
  if ($("myNumber") && currentVirtualNumber) $("myNumber").textContent = `ID WhatApp: ${currentVirtualNumber} · bukan nomor telepon`;
}
async function loadPeople() {
  if (!supabase || !currentUser) { people = [...demoPeople]; renderChats($("filterChats").value); return; }
  const { data, error } = await supabase.from("profiles").select("id,display_name,avatar_url,virtual_number").neq("id", currentUser.id).order("display_name").limit(100);
  if (error) return toast(`Kontak gagal dimuat: ${error.message}`);
  people = (data || []).map((p) => ({ id: p.id, name: p.display_name, avatar: p.avatar_url || "🙂", virtual_number: p.virtual_number, preview: p.virtual_number || "Mulai percakapan baru", status: "tersedia" }));
  renderChats($("filterChats").value);
}
async function startNewChat() {
  if (!supabase || !currentUser) {
    const value = prompt("Masukkan nama kontak demo baru:"); const name = value?.trim(); if (!name) return;
    const exists = people.find((person) => person.name.toLowerCase() === name.toLowerCase());
    if (exists) return openChat(exists);
    const person = { id: `demo-${Date.now()}`, name, avatar: "🙂", preview: "Mulai percakapan baru", status: "demo lokal", demo: true };
    people.unshift(person); renderChats($("filterChats").value); return openChat(person);
  }
  const value = prompt("Masukkan ID WhatApp kontak (contoh: WA-1234-5678):"); const identifier = value?.trim(); if (!identifier) return;
  const { data, error } = await supabase.from("profiles").select("id,display_name,avatar_url,virtual_number").eq("virtual_number", identifier.toUpperCase()).maybeSingle();
  if (error) return toast(`Pencarian gagal: ${error.message}`);
  if (!data) return toast("ID WhatApp tidak ditemukan.");
  let person = people.find((item) => item.id === data.id);
  if (!person) { person = { id: data.id, name: data.display_name, avatar: data.avatar_url || "🙂", virtual_number: data.virtual_number, preview: "Mulai percakapan baru", status: "tersedia" }; people.unshift(person); }
  renderChats($("filterChats").value); openChat(person);
}
async function initSupabase() {
  const ready = cfg.SUPABASE_URL?.startsWith("https://") && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
  if (!ready || !window.supabase?.createClient) { people = [...demoPeople]; renderChats(); $("authScreen").classList.remove("hidden"); return; }
  try {
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data, error } = await supabase.auth.getSession(); if (error) throw error;
    currentUser = data.session?.user || null; $("authScreen").classList.toggle("hidden", !!currentUser);
    if (currentUser) { await ensureProfile(); await loadPeople(); subscribeToMessages(); }
    supabase.auth.onAuthStateChange((_event, nextSession) => {
      currentUser = nextSession?.user || null; $("authScreen").classList.toggle("hidden", !!currentUser);
      if (currentUser) setTimeout(async () => { await ensureProfile(); await loadPeople(); subscribeToMessages(); }, 0);
      else { people = [...demoPeople]; renderChats(); }
    });
  } catch (error) {
    supabase = null; people = [...demoPeople]; renderChats(); $("authScreen").classList.remove("hidden");
    $("authMessage").textContent = `Koneksi layanan belum siap: ${error.message}`;
  }
}
async function auth(signup) {
  if (!supabase) { $("authMessage").textContent = "Layanan akun belum dikonfigurasi. Anda tetap dapat mencoba demo lokal."; return; }
  const email = $("email").value.trim(); const password = $("password").value;
  if (!email || password.length < 6) { $("authMessage").textContent = "Masukkan email yang valid dan kata sandi minimal 6 karakter."; return; }
  $("loginBtn").disabled = $("signupBtn").disabled = true;
  try {
    const result = signup ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }) : await supabase.auth.signInWithPassword({ email, password });
    $("authMessage").textContent = result.error ? result.error.message : (signup ? "Akun dibuat. Periksa email untuk verifikasi sebelum masuk." : "Berhasil masuk.");
  } catch (error) { $("authMessage").textContent = `Terjadi masalah: ${error.message}`; }
  finally { $("loginBtn").disabled = $("signupBtn").disabled = false; }
}
document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active")); btn.classList.add("active");
  showPage({ chats: "chatsPage", updates: "updatesPage", calls: "callsPage" }[btn.dataset.tab]);
  if (btn.dataset.tab === "chats") renderChats($("filterChats").value);
}));
$("filterChats").addEventListener("input", (event) => renderChats(event.target.value));
$("backBtn").onclick = () => { showPage("chatsPage"); document.querySelector('[data-tab="chats"]').click(); };
$("sendBtn").onclick = () => sendMessage($("messageInput").value);
$("messageInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(event.target.value); } });
$("voiceCallBtn").onclick = $("videoCallBtn").onclick = startCall;
$("endCallBtn").onclick = $("minimizeCall").onclick = () => { $("callScreen").classList.add("hidden"); $("mainScreen").classList.remove("hidden"); };
$("muteBtn").onclick = $("speakerBtn").onclick = $("videoToggle").onclick = startCall;
$("attachBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = (event) => { const file = event.target.files[0]; if (file) sendMessage("", file); };
$("newChatBtn").onclick = $("composeBtn").onclick = startNewChat;
$("startCallFromList").onclick = startCall;
document.querySelectorAll("[data-call]").forEach((button) => button.onclick = startCall);
$("menuBtn").onclick = async () => {
  if (supabase && currentUser) { if (confirm("Keluar dari akun WhatApp?")) { await supabase.auth.signOut(); toast("Anda telah keluar."); } }
  else toast("Mode demo aktif. Akun dan sinkronisasi memerlukan koneksi Supabase.");
};
$("searchBtn").onclick = () => { $("filterChats").focus(); $("filterChats").scrollIntoView({ behavior: "smooth", block: "center" }); };
$("demoBtn").onclick = () => { $("authScreen").classList.add("hidden"); people = [...demoPeople]; renderChats(); toast("Mode demo lokal aktif; pesan disimpan di perangkat ini saja."); };
$("loginBtn").onclick = () => auth(false); $("signupBtn").onclick = () => auth(true);
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; $("installBtn").classList.remove("hidden"); });
$("installBtn").onclick = async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("installBtn").classList.add("hidden"); };
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; $("installBtn").classList.add("hidden"); toast("WhatApp berhasil dipasang"); });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
renderChats(); initSupabase();

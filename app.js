const $ = (id) => document.getElementById(id);
const cfg = window.WHATAPP_CONFIG || {};
const VAPID_PUBLIC_KEY = "BEWV8LHeRZn9MGpdHNDcCC0FQ1Sk5rw8Owdh5ehjEKP_2Ok8FsUF6bCglfx3O68M3bkE5VpKoOXu6UkkTa_fVuY";
let supabase = null;
let currentUser = null;
let activeChat = null;
let realtimeChannel = null;
let people = [];
let deferredInstallPrompt = null;
let currentVirtualNumber = null;
let currentProfileName = "";
let supabaseInitStarted = false;
let supabaseModulePromise = null;
let callSignalsChannel = null;
let callSignalsReady = false;
let peerConnection = null;
let localMediaStream = null;
let remoteMediaStream = null;
let activeCall = null;
let incomingCall = null;
let incomingCallPeer = null;
let callTimeout = null;
let speakerMuted = false;
let ringAudioContext = null;
let ringtoneTimer = null;
let ringVibrateTimer = null;
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
}
function unlockRingtoneAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return Promise.resolve(false);
  try {
    ringAudioContext ||= new AudioContextClass();
    return ringAudioContext.state === "suspended" ? ringAudioContext.resume().then(() => ringAudioContext.state === "running").catch((error) => { console.warn("Ringtone audio resume failed", error); return false; }) : Promise.resolve(ringAudioContext.state === "running");
  } catch (error) { console.warn("Ringtone audio unavailable", error); return Promise.resolve(false); }
}
function playRingtonePulse() {
  if (!incomingCall || !ringAudioContext || ringAudioContext.state !== "running") return;
  const now = ringAudioContext.currentTime;
  const gain = ringAudioContext.createGain();
  gain.gain.setValueAtTime(0.85, now);
  gain.connect(ringAudioContext.destination);
  [{ at: 0, frequency: 660 }, { at: 0.42, frequency: 880 }, { at: 1.05, frequency: 660 }, { at: 1.47, frequency: 880 }].forEach(({ at, frequency }) => {
    const oscillator = ringAudioContext.createOscillator();
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(frequency, now + at);
    const tone = ringAudioContext.createGain();
    tone.gain.setValueAtTime(0.0001, now + at);
    tone.gain.linearRampToValueAtTime(0.32, now + at + 0.035);
    tone.gain.setValueAtTime(0.32, now + at + 0.27);
    tone.gain.linearRampToValueAtTime(0.0001, now + at + 0.34);
    oscillator.connect(tone); tone.connect(gain); oscillator.start(now + at); oscillator.stop(now + at + 0.36);
  });
}
async function startRingtone() {
  stopRingtone();
  if (navigator.vibrate) {
    try { navigator.vibrate([700, 350, 700, 350, 700]); ringVibrateTimer = setInterval(() => navigator.vibrate([700, 350, 700, 350, 700]), 2800); }
    catch (error) { console.warn("Call vibration unavailable", error); }
  }
  try {
    await unlockRingtoneAudio();
    playRingtonePulse();
    ringtoneTimer = setInterval(playRingtonePulse, 2800);
  } catch (error) { console.warn("Could not start incoming-call ringtone", error); }
}
function stopRingtone() {
  clearInterval(ringtoneTimer); ringtoneTimer = null;
  clearInterval(ringVibrateTimer); ringVibrateTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
}
function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
async function updateCallNotificationStatus() {
  const button = $("enableCallNotifications");
  const status = $("callNotifyStatus");
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
    status.textContent = "Browser ini tidak mendukung push. Gunakan Chrome terbaru dan pasang WhatApp ke layar utama.";
    button.disabled = true; return;
  }
  if (!currentUser) { status.textContent = "Masuk untuk mendaftarkan perangkat ini."; button.textContent = "Aktifkan pemberitahuan"; button.disabled = true; return; }
  if (Notification.permission === "denied") {
    status.textContent = "Diblokir. Ubah izin notifikasi WhatApp melalui setelan situs Chrome.";
    button.textContent = "Izin diblokir"; button.disabled = true;
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === "granted") {
      status.textContent = "Push aktif di perangkat ini. Panggilan masuk akan memberi notifikasi saat tab ditutup, selama Chrome mengizinkan notifikasi latar.";
      button.textContent = "Matikan di perangkat ini"; button.disabled = false;
    } else {
      status.textContent = "Aktifkan push di perangkat ini. Izinkan notifikasi agar panggilan tetap memberi kabar saat tab ditutup.";
      button.textContent = "Aktifkan panggilan latar"; button.disabled = false;
    }
  } catch (error) { status.textContent = `Push belum tersedia: ${error.message}`; button.disabled = true; }
}
async function showCallNotification(title, body, callId) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = { body, icon: "./icons/icon-192.png", tag: `whatapp-call-${callId}`, renotify: true, requireInteraction: true, silent: false, vibrate: [900, 450, 900, 450, 900], data: { url: new URL("./", location.href).href, callId } };
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, options);
  } else new Notification(title, options);
}
async function openCallFromPush(signalId) {
  if (!signalId || !supabase || !currentUser) { if (signalId) sessionStorage.setItem("whatapp-pending-call-signal", signalId); return; }
  const { data, error } = await supabase.from("call_signals").select("id,call_id,sender_id,receiver_id,kind,payload").eq("id", signalId).eq("receiver_id", currentUser.id).maybeSingle();
  if (error) throw error;
  if (data) await handleCallSignal(data);
  else toast("Panggilan ini sudah tidak tersedia.");
  sessionStorage.removeItem("whatapp-pending-call-signal");
  const url = new URL(location.href); url.searchParams.delete("incoming_call"); history.replaceState({}, "", url.pathname + url.hash);
}
function pushOnboardingKey() { return `whatapp-push-onboarding:${currentUser?.id || ""}`; }
async function savePushSubscription(subscription) {
  const { error } = await supabase.from("call_push_subscriptions").upsert({ user_id: currentUser.id, endpoint: subscription.endpoint, subscription: subscription.toJSON(), updated_at: new Date().toISOString() }, { onConflict: "endpoint" });
  if (error) throw error;
}
async function activatePushSubscription() {
  if (!currentUser || !supabase) throw new Error("Masuk terlebih dahulu.");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Izin notifikasi tidak diberikan.");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) });
  await savePushSubscription(subscription);
  localStorage.setItem(pushOnboardingKey(), "active");
  return subscription;
}
async function maybeOfferPushOnFirstLogin() {
  if (!currentUser || !supabase || !("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === "granted") {
      await savePushSubscription(subscription);
      localStorage.setItem(pushOnboardingKey(), "active");
      return;
    }
    if (Notification.permission === "denied" || localStorage.getItem(pushOnboardingKey())) return;
    const dialog = $("pushWelcomeDialog");
    if (!dialog.open) dialog.showModal();
  } catch (error) { console.warn("Push onboarding unavailable", error); }
}
async function enableCallNotifications() {
  if (!("Notification" in window) || !currentUser || !supabase) return updateCallNotificationStatus();
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      const { error } = await supabase.from("call_push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", currentUser.id);
      if (error) throw error;
      localStorage.setItem(pushOnboardingKey(), "deferred");
      toast("Pemberitahuan panggilan dimatikan di perangkat ini.");
    } else {
      try { await activatePushSubscription(); }
      catch (error) { toast(`Izin notifikasi gagal: ${error.message}`); return; }
      toast("Panggilan latar aktif di perangkat ini. Coba uji dengan halaman ditutup.");
      await showCallNotification("Panggilan latar aktif", "Perangkat ini terdaftar menerima pemberitahuan panggilan.", `test-${Date.now()}`);
    }
    await updateCallNotificationStatus();
  } catch (error) { toast(`Izin notifikasi gagal: ${error.message}`); }
}
function showPage(page) {
  ["chatsPage", "updatesPage", "callsPage", "conversationPage"].forEach((id) => $(id).classList.add("hidden"));
  $(page).classList.remove("hidden");
}
function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
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
    empty.textContent = query ? "Kontak tidak ditemukan. Coba cari nama atau ID WhatApp." : (currentUser ? "Belum ada obrolan. Ketuk + untuk memulai percakapan." : "Masuk dengan akun Anda untuk melihat obrolan.");
    list.appendChild(empty);
  }
}
function renderMessages(messages = []) {
  const container = $("messages"); container.innerHTML = '<div class="date-chip">OBROLAN</div>';
  messages.forEach((message) => {
    const bubble = document.createElement("div");
  bubble.className = `bubble ${message.sender_id === currentUser?.id ? "sent" : "received"}`;
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
  if (!supabase || !currentUser) return toast("Masuk ke akun WhatApp untuk mengirim pesan.");
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
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }] };
function waitForIceGathering(pc, timeout = 10000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", check); resolve(); };
    const check = () => { if (pc.iceGatheringState === "complete") finish(); };
    const timer = setTimeout(finish, timeout);
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });
}
async function sendCallSignal(receiverId, callId, kind, payload = {}) {
  const { error } = await supabase.from("call_signals").insert({ call_id: callId, sender_id: currentUser.id, receiver_id: receiverId, kind, payload });
  if (error) throw error;
}
function showActiveCall(peer, mode, status = "Menghubungkan…") {
  speakerMuted = false; $("remoteAudio").muted = false; $("remoteVideo").muted = true;
  $("muteBtn").classList.add("muted"); $("muteBtn").querySelector("small").textContent = "Bisukan";
  $("speakerBtn").classList.remove("muted"); $("speakerBtn").querySelector("small").textContent = "Speaker";
  $("videoToggle").classList.remove("muted"); $("videoToggle").querySelector("small").textContent = "Video";
  $("callerName").textContent = peer.name || "Kontak WhatApp";
  $("callerAvatar").textContent = peer.avatar || "🙂";
  $("callTypeLabel").textContent = mode === "video" ? "Panggilan video" : "Panggilan suara";
  $("callStatus").textContent = status;
  $("resumeCallBtn").classList.add("hidden");
  $("remoteVideo").classList.toggle("hidden", mode !== "video");
  $("localVideo").classList.toggle("hidden", mode !== "video");
  $("callerAvatar").classList.toggle("hidden", mode === "video");
  $("mainScreen").classList.add("hidden");
  $("callScreen").classList.remove("hidden");
}
function attachLocalMedia(stream, mode) {
  localMediaStream = stream;
  $("localVideo").srcObject = mode === "video" ? stream : null;
}
function makePeerConnection(peer, mode) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnection = pc;
  remoteMediaStream = new MediaStream();
  $("remoteVideo").srcObject = remoteMediaStream;
  $("remoteAudio").srcObject = remoteMediaStream;
  localMediaStream.getTracks().forEach((track) => pc.addTrack(track, localMediaStream));
  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (stream) {
      stream.getTracks().forEach((track) => { if (!remoteMediaStream.getTrackById(track.id)) remoteMediaStream.addTrack(track); });
    } else if (!remoteMediaStream.getTrackById(event.track.id)) remoteMediaStream.addTrack(event.track);
    $("callStatus").textContent = "Terhubung";
    if (mode === "video") $("remoteVideo").play().catch(() => {});
    else $("remoteAudio").play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (!activeCall || activeCall.peer.id !== peer.id) return;
    if (pc.connectionState === "connected") $("callStatus").textContent = "Terhubung";
    else if (pc.connectionState === "failed") $("callStatus").textContent = "Koneksi gagal; jaringan ini mungkin memerlukan TURN.";
    else if (pc.connectionState === "disconnected") $("callStatus").textContent = "Koneksi terputus…";
  };
  return pc;
}
async function startCall(mode = "audio") {
  if (!supabase || !currentUser) return toast("Masuk ke akun WhatApp untuk menelepon.");
  if (!activeChat) return toast("Buka obrolan kontak terlebih dahulu.");
  if (activeCall || incomingCall) return toast("Akhiri panggilan yang sedang berlangsung terlebih dahulu.");
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") return toast("Browser ini tidak mendukung panggilan. Buka situs melalui HTTPS di browser terbaru.");
  try {
    if (!callSignalsReady) await subscribeToCallSignals();
    if (!callSignalsReady) return toast("Layanan notifikasi panggilan belum tersambung. Coba lagi sebentar.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
    const callId = crypto.randomUUID();
    const peer = { id: activeChat.id, name: activeChat.name, avatar: activeChat.avatar };
    activeCall = { id: callId, peer, mode, initiator: true };
    attachLocalMedia(stream, mode);
    const pc = makePeerConnection(peer, mode);
    showActiveCall(peer, mode, "Memanggil…");
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGathering(pc);
    await sendCallSignal(peer.id, callId, "offer", { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }, mode });
    callTimeout = setTimeout(() => { if (activeCall?.id === callId && pc.connectionState !== "connected") { toast("Tidak dijawab."); finishCall(false); } }, 45000);
  } catch (error) {
    await finishCall(false);
    toast(error.name === "NotAllowedError" ? "Izinkan akses mikrofon/kamera di pengaturan browser." : `Panggilan gagal dimulai: ${error.message}`);
  }
}
async function subscribeToCallSignals() {
  if (!supabase || !currentUser) return false;
  if (callSignalsReady) return true;
  if (callSignalsChannel) await supabase.removeChannel(callSignalsChannel);
  callSignalsReady = false;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => { if (settled) return; settled = true; clearTimeout(timer); callSignalsReady = ready; resolve(ready); };
    const timer = setTimeout(() => finish(false), 12000);
    callSignalsChannel = supabase.channel(`call-signals:${currentUser.id}`).on("postgres_changes", {
      event: "INSERT", schema: "public", table: "call_signals", filter: `receiver_id=eq.${currentUser.id}`
    }, ({ new: signal }) => { handleCallSignal(signal).catch((error) => toast(`Sinyal panggilan gagal: ${error.message}`)); }).subscribe((status) => {
      if (status === "SUBSCRIBED") finish(true);
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { toast("Notifikasi panggilan tidak tersambung. Muat ulang aplikasi."); finish(false); }
    });
  });
}
async function handleCallSignal(signal) {
  if (!currentUser || signal.sender_id === currentUser.id) return;
  if (signal.kind === "offer") {
    if (incomingCall?.call_id === signal.call_id) return;
    if (activeCall || incomingCall) { await sendCallSignal(signal.sender_id, signal.call_id, "busy"); return; }
    const { data } = await supabase.from("profiles").select("display_name,avatar_url").eq("id", signal.sender_id).maybeSingle();
    incomingCall = signal;
    incomingCallPeer = { id: signal.sender_id, name: data?.display_name || "Kontak WhatApp", avatar: data?.avatar_url || "🙂" };
    $("incomingScreen").querySelector("h2").textContent = incomingCallPeer.name;
    $("incomingKind").textContent = signal.payload?.mode === "video" ? "Panggilan video masuk" : "Panggilan suara masuk";
    $("incomingScreen").classList.remove("hidden");
    startRingtone();
    return;
  }
  if (!activeCall || signal.call_id !== activeCall.id) return;
  if (signal.kind === "answer" && peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
    clearTimeout(callTimeout); $("callStatus").textContent = "Menyambungkan…";
  } else if (signal.kind === "reject" || signal.kind === "busy" || signal.kind === "hangup") {
    const reason = signal.kind === "busy" ? "Kontak sedang sibuk." : signal.kind === "reject" ? "Panggilan ditolak." : "Panggilan diakhiri.";
    await finishCall(false); toast(reason);
  }
}
async function acceptCall() {
  if (!incomingCall || !incomingCallPeer || !supabase || !currentUser) return;
  const signal = incomingCall; const peer = incomingCallPeer; const mode = signal.payload?.mode === "video" ? "video" : "audio";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
    activeCall = { id: signal.call_id, peer, mode, initiator: false };
    stopRingtone();
    incomingCall = null; incomingCallPeer = null;
    $("incomingScreen").classList.add("hidden"); attachLocalMedia(stream, mode);
    const pc = makePeerConnection(peer, mode); showActiveCall(peer, mode, "Menyambungkan…");
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIceGathering(pc);
    await sendCallSignal(peer.id, signal.call_id, "answer", { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
  } catch (error) {
    await finishCall(false);
    toast(error.name === "NotAllowedError" ? "Izinkan akses mikrofon/kamera di pengaturan browser." : `Gagal menerima panggilan: ${error.message}`);
  }
}
async function declineCall() {
  const signal = incomingCall; incomingCall = null; incomingCallPeer = null;
  stopRingtone();
  $("incomingScreen").classList.add("hidden");
  if (signal && supabase && currentUser) {
    try { await sendCallSignal(signal.sender_id, signal.call_id, "reject"); } catch (error) { toast(`Panggilan ditolak, tetapi sinyal gagal dikirim: ${error.message}`); }
  }
}
async function finishCall(notifyPeer = true) {
  stopRingtone();
  clearTimeout(callTimeout); callTimeout = null;
  const call = activeCall;
  if (notifyPeer && call && supabase && currentUser) {
    try { await sendCallSignal(call.peer.id, call.id, "hangup"); } catch (error) { console.warn("Could not send call hangup", error); }
  }
  if (peerConnection) { peerConnection.ontrack = null; peerConnection.close(); peerConnection = null; }
  localMediaStream?.getTracks().forEach((track) => track.stop()); localMediaStream = null;
  remoteMediaStream?.getTracks().forEach((track) => track.stop()); remoteMediaStream = null;
  $("localVideo").srcObject = null; $("remoteVideo").srcObject = null; $("remoteAudio").srcObject = null;
  activeCall = null; incomingCall = null; incomingCallPeer = null;
  $("callScreen").classList.add("hidden"); $("incomingScreen").classList.add("hidden");
  $("resumeCallBtn").classList.add("hidden");
  if (currentUser) $("mainScreen").classList.remove("hidden");
}
function toggleMute() {
  if (!localMediaStream) return;
  const track = localMediaStream.getAudioTracks()[0]; if (!track) return;
  track.enabled = !track.enabled; $("muteBtn").classList.toggle("muted", !track.enabled);
  $("muteBtn").querySelector("small").textContent = track.enabled ? "Bisukan" : "Aktifkan suara";
}
function toggleSpeaker() {
  speakerMuted = !speakerMuted; $("remoteAudio").muted = speakerMuted;
  $("speakerBtn").classList.toggle("muted", speakerMuted);
  $("speakerBtn").querySelector("small").textContent = speakerMuted ? "Nyalakan audio" : "Speaker";
}
function toggleVideo() {
  const track = localMediaStream?.getVideoTracks()[0];
  if (!track) return toast("Video tidak aktif pada panggilan ini.");
  track.enabled = !track.enabled; $("videoToggle").classList.toggle("muted", !track.enabled);
  $("videoToggle").querySelector("small").textContent = track.enabled ? "Matikan video" : "Nyalakan video";
}
function createVirtualId() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  const part = (value) => String(value % 9000 + 1000);
  return `WA-${part(bytes[0])}-${part(bytes[1])}`;
}
async function loadSupabaseSdk() {
  if (window.supabase?.createClient) return window.supabase;
  if (!supabaseModulePromise) {
    supabaseModulePromise = import("https://esm.sh/@supabase/supabase-js@2")
      .catch(() => import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"))
      .then((sdk) => {
        if (typeof sdk.createClient !== "function") throw new Error("SDK tidak menyediakan createClient");
        window.supabase = sdk;
        return sdk;
      });
  }
  return supabaseModulePromise;
}
async function ensureProfile() {
  if (!supabase || !currentUser) return;
  const fallbackName = currentUser.user_metadata?.display_name || currentUser.email?.split("@")[0] || "Pengguna";
  const existing = await supabase.from("profiles").select("display_name,virtual_number").eq("id", currentUser.id).maybeSingle();
  if (existing.error) return toast(`Profil gagal dibaca: ${existing.error.message}`);
  const name = existing.data?.display_name?.trim() || fallbackName;
  const existingId = existing.data?.virtual_number || null;
  let saved = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = existingId || createVirtualId();
    saved = await supabase.from("profiles").upsert(
      { id: currentUser.id, display_name: name, virtual_number: candidate },
      { onConflict: "id" }
    ).select("display_name,virtual_number").single();
    if (!saved.error) break;
    // Unique constraint virtual_number is the final authority under concurrent sign-ups.
    if (existingId || saved.error.code !== "23505") break;
  }
  if (saved?.error) return toast(`ID kontak gagal dibuat: ${saved.error.message}`);
  currentVirtualNumber = saved?.data?.virtual_number || null;
  currentProfileName = saved?.data?.display_name || name;
  $("profileName").value = currentProfileName;
  $("profileEmail").textContent = currentUser.email || "Email tidak tersedia";
  $("profileNumber").textContent = currentVirtualNumber || "Belum dibuat";
  $("profileBtn").textContent = currentProfileName.trim().charAt(0).toUpperCase() || "🙂";
  if ($("myNumber") && currentVirtualNumber) {
    $("myNumber").textContent = `ID WhatApp: ${currentVirtualNumber} · bukan nomor telepon`;
    $("copyIdBtn").classList.remove("hidden");
  }
}
async function loadPeople() {
  if (!supabase || !currentUser) { people = []; renderChats($("filterChats").value); return; }
  const { data, error } = await supabase.from("profiles").select("id,display_name,avatar_url,virtual_number").neq("id", currentUser.id).order("display_name").limit(100);
  if (error) return toast(`Kontak gagal dimuat: ${error.message}`);
  people = (data || []).map((p) => ({ id: p.id, name: p.display_name, avatar: p.avatar_url || "🙂", virtual_number: p.virtual_number, preview: p.virtual_number || "Mulai percakapan baru", status: "tersedia" }));
  renderChats($("filterChats").value);
}
function startNewChat() {
  if (!supabase || !currentUser) return toast("Masuk ke akun WhatApp untuk memulai obrolan.");
  $("newChatError").classList.add("hidden");
  $("newChatError").textContent = "";
  $("contactInput").value = "";
  $("contactLabel").textContent = "ID WhatApp teman";
  $("contactInput").placeholder = "WA-1234-5678";
  $("newChatHelp").textContent = "Minta teman membagikan ID WhatApp miliknya. ID ini bukan nomor telepon.";
  const dialog = $("newChatDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else { toast("Browser ini belum mendukung formulir chat. Perbarui Chrome lalu coba lagi."); return; }
  setTimeout(() => $("contactInput").focus(), 50);
}
async function handleNewChat(event) {
  event.preventDefault();
  const identifier = $("contactInput").value.trim();
  if (!identifier) return;
  const showError = (message) => { $("newChatError").textContent = message; $("newChatError").classList.remove("hidden"); };
  if (!supabase || !currentUser) return showError("Masuk ke akun WhatApp untuk mencari kontak.");
  const { data, error } = await supabase.from("profiles").select("id,display_name,avatar_url,virtual_number").eq("virtual_number", identifier.toUpperCase()).maybeSingle();
  if (error) return showError(`Pencarian gagal: ${error.message}`);
  if (!data) return showError("ID tidak ditemukan. Periksa huruf dan angka, lalu coba lagi.");
  if (data.id === currentUser.id) return showError("Itu ID akun Anda sendiri. Masukkan ID teman.");
  let person = people.find((item) => item.id === data.id);
  if (!person) { person = { id: data.id, name: data.display_name, avatar: data.avatar_url || "🙂", virtual_number: data.virtual_number, preview: "Mulai percakapan baru", status: "tersedia" }; people.unshift(person); }
  $("newChatDialog").close(); renderChats($("filterChats").value); await openChat(person);
}
async function initSupabase() {
  const ready = cfg.SUPABASE_URL?.startsWith("https://") && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
  if (!ready) {
    people = []; renderChats(); $("authScreen").classList.remove("hidden"); $("mainScreen").classList.add("hidden");
    $("authMessage").textContent = "Layanan akun belum dikonfigurasi. Hubungi pengelola aplikasi.";
    return;
  }
  if (!window.supabase?.createClient) throw new Error("SDK autentikasi belum siap");
  if (supabaseInitStarted) return;
  supabaseInitStarted = true;
  try {
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data, error } = await supabase.auth.getSession(); if (error) throw error;
    currentUser = data.session?.user || null;
    $("authScreen").classList.toggle("hidden", !!currentUser);
    $("mainScreen").classList.toggle("hidden", !currentUser);
    $("profileBtn").classList.toggle("hidden", !currentUser);
    $("authMessage").textContent = currentUser ? "" : "Masuk dengan akun Anda atau buat akun baru.";
    if (currentUser) {
      await ensureProfile(); await loadPeople(); subscribeToMessages(); await subscribeToCallSignals(); updateCallNotificationStatus(); await maybeOfferPushOnFirstLogin();
      const pendingSignal = new URL(location.href).searchParams.get("incoming_call") || sessionStorage.getItem("whatapp-pending-call-signal");
      if (pendingSignal) await openCallFromPush(pendingSignal);
    }
    supabase.auth.onAuthStateChange((_event, nextSession) => {
      currentUser = nextSession?.user || null;
      $("authScreen").classList.toggle("hidden", !!currentUser);
      $("mainScreen").classList.toggle("hidden", !currentUser);
      $("profileBtn").classList.toggle("hidden", !currentUser);
      if (currentUser) setTimeout(async () => {
        await ensureProfile(); await loadPeople(); subscribeToMessages(); await subscribeToCallSignals(); updateCallNotificationStatus(); await maybeOfferPushOnFirstLogin();
        const pendingSignal = new URL(location.href).searchParams.get("incoming_call") || sessionStorage.getItem("whatapp-pending-call-signal");
        if (pendingSignal) await openCallFromPush(pendingSignal);
      }, 0);
      else {
        if (callSignalsChannel) supabase.removeChannel(callSignalsChannel);
        callSignalsChannel = null; callSignalsReady = false; finishCall(false);
        updateCallNotificationStatus();
        people = []; currentVirtualNumber = null; currentProfileName = ""; renderChats();
      }
    });
  } catch (error) {
    supabaseInitStarted = false;
    supabase = null; currentUser = null; people = []; renderChats(); $("authScreen").classList.remove("hidden"); $("mainScreen").classList.add("hidden");
    $("authMessage").textContent = `Koneksi layanan belum siap: ${error.message}`;
  } finally {
    $("loginBtn").disabled = false;
    $("signupBtn").disabled = false;
  }
}
function openProfile() {
  if (!currentUser) return toast("Masuk ke akun WhatApp untuk membuka profil.");
  updateCallNotificationStatus();
  $("profileError").classList.add("hidden");
  $("profileError").textContent = "";
  $("profileName").value = currentProfileName;
  $("profileEmail").textContent = currentUser.email || "Email tidak tersedia";
  $("profileNumber").textContent = currentVirtualNumber || "Belum dibuat";
  $("profileDialog").showModal();
}
async function saveProfile(event) {
  event.preventDefault();
  if (!supabase || !currentUser) return;
  const name = $("profileName").value.trim();
  if (name.length < 2) {
    $("profileError").textContent = "Nama tampilan harus minimal 2 karakter.";
    $("profileError").classList.remove("hidden");
    return;
  }
  $("saveProfile").disabled = true;
  const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", currentUser.id);
  $("saveProfile").disabled = false;
  if (error) {
    $("profileError").textContent = `Nama gagal disimpan: ${error.message}`;
    $("profileError").classList.remove("hidden");
    return;
  }
  currentProfileName = name;
  $("profileBtn").textContent = name.charAt(0).toUpperCase();
  $("profileDialog").close();
  toast("Profil berhasil diperbarui.");
}
async function auth(signup) {
  if (!supabase) { $("authMessage").textContent = "Layanan akun belum siap. Periksa koneksi internet lalu muat ulang halaman."; return; }
  const email = $("email").value.trim(); const password = $("password").value;
  if (!email || password.length < 6) { $("authMessage").textContent = "Masukkan email yang valid dan kata sandi minimal 6 karakter."; return; }
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("loginBtn").disabled = $("signupBtn").disabled = true;
  try {
    const redirectUrl = new URL("./", window.location.href).href;
    const result = signup ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl } }) : await supabase.auth.signInWithPassword({ email, password });
    $("authMessage").textContent = result.error ? result.error.message : (signup
      ? (result.data?.session ? "Akun dibuat dan Anda sudah masuk. ID kontak sedang dibuat." : "Akun dibuat. Buka tautan verifikasi di email Anda. Tautan akan kembali ke WhatApp; setelah itu masuk untuk membuat ID kontak.")
      : "Berhasil masuk. ID kontak sedang disiapkan.");
  } catch (error) { $("authMessage").textContent = `Terjadi masalah: ${error.message}`; }
  finally { $("loginBtn").disabled = $("signupBtn").disabled = false; }
}
document.addEventListener("pointerdown", unlockRingtoneAudio, { once: true, capture: true });
document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active")); btn.classList.add("active");
  showPage({ chats: "chatsPage", updates: "updatesPage", calls: "callsPage" }[btn.dataset.tab]);
  if (btn.dataset.tab === "chats") renderChats($("filterChats").value);
}));
$("filterChats").addEventListener("input", (event) => renderChats(event.target.value));
$("backBtn").onclick = () => { showPage("chatsPage"); document.querySelector('[data-tab="chats"]').click(); };
$("sendBtn").onclick = () => sendMessage($("messageInput").value);
$("messageInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(event.target.value); } });
$("voiceCallBtn").onclick = () => startCall("audio");
$("videoCallBtn").onclick = () => startCall("video");
$("endCallBtn").onclick = () => finishCall(true);
$("minimizeCall").onclick = () => { $("callScreen").classList.add("hidden"); $("mainScreen").classList.remove("hidden"); $("resumeCallBtn").classList.toggle("hidden", !activeCall); };
$("resumeCallBtn").onclick = () => { if (!activeCall) return; $("mainScreen").classList.add("hidden"); $("resumeCallBtn").classList.add("hidden"); $("callScreen").classList.remove("hidden"); };
$("muteBtn").onclick = toggleMute;
$("speakerBtn").onclick = toggleSpeaker;
$("videoToggle").onclick = toggleVideo;
$("attachBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = (event) => { const file = event.target.files[0]; if (file) sendMessage("", file); };
$("newChatBtn").onclick = $("composeBtn").onclick = startNewChat;
$("newChatForm").addEventListener("submit", handleNewChat);
$("cancelNewChat").onclick = () => $("newChatDialog").close();
$("newChatDialog").addEventListener("click", (event) => { if (event.target === $("newChatDialog")) $("newChatDialog").close(); });
$("copyIdBtn").onclick = async () => {
  if (!currentVirtualNumber) return toast("Masuk untuk mendapatkan ID WhatApp.");
  try { await navigator.clipboard.writeText(currentVirtualNumber); toast("ID WhatApp disalin. Bagikan kepada teman."); }
  catch { toast(`ID WhatApp Anda: ${currentVirtualNumber}`); }
};
$("profileBtn").onclick = openProfile;
$("enableCallNotifications").onclick = enableCallNotifications;
$("pushWelcomeEnable").onclick = async () => {
  const button = $("pushWelcomeEnable"); button.disabled = true;
  try {
    await activatePushSubscription();
    $("pushWelcomeDialog").close();
    await updateCallNotificationStatus();
    await showCallNotification("Panggilan latar aktif", "Perangkat ini siap menerima pemberitahuan panggilan.", `test-${Date.now()}`);
    toast("Notifikasi panggilan aktif di perangkat ini.");
  } catch (error) {
    toast(`Belum aktif: ${error.message} Buka Profil untuk mencoba lagi.`);
  } finally { button.disabled = false; }
};
$("pushWelcomeLater").onclick = () => { localStorage.setItem(pushOnboardingKey(), "deferred"); $("pushWelcomeDialog").close(); };
$("pushWelcomeDialog").addEventListener("cancel", (event) => { event.preventDefault(); localStorage.setItem(pushOnboardingKey(), "deferred"); $("pushWelcomeDialog").close(); });
$("pushWelcomeDialog").addEventListener("click", (event) => { if (event.target === $("pushWelcomeDialog")) { localStorage.setItem(pushOnboardingKey(), "deferred"); $("pushWelcomeDialog").close(); } });
$("profileForm").addEventListener("submit", saveProfile);
$("closeProfile").onclick = () => $("profileDialog").close();
$("profileDialog").addEventListener("click", (event) => { if (event.target === $("profileDialog")) $("profileDialog").close(); });
$("copyProfileId").onclick = async () => {
  if (!currentVirtualNumber) return toast("ID WhatApp belum tersedia.");
  try { await navigator.clipboard.writeText(currentVirtualNumber); toast("ID WhatApp disalin."); }
  catch { toast(`ID WhatApp Anda: ${currentVirtualNumber}`); }
};
$("startCallFromList").onclick = () => toast("Buka obrolan kontak terlebih dahulu untuk menelepon.");
$("acceptBtn").onclick = acceptCall;
$("declineBtn").onclick = declineCall;
document.querySelectorAll("[data-call]").forEach((button) => button.onclick = startCall);
$("menuBtn").onclick = async () => {
  if (supabase && currentUser) { if (confirm("Keluar dari akun WhatApp?")) { await supabase.auth.signOut(); toast("Anda telah keluar."); } }
  else toast("Masuk ke akun WhatApp untuk menggunakan aplikasi.");
};
$("searchBtn").onclick = () => { $("filterChats").focus(); $("filterChats").scrollIntoView({ behavior: "smooth", block: "center" }); };
$("loginBtn").onclick = () => auth(false); $("signupBtn").onclick = () => auth(true);
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; $("installBtn").classList.remove("hidden"); });
$("installBtn").onclick = async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("installBtn").classList.add("hidden"); };
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; $("installBtn").classList.add("hidden"); toast("WhatApp berhasil dipasang"); if (currentUser) maybeOfferPushOnFirstLogin(); });
if ("serviceWorker" in navigator) {
  let reloadedForControllerChange = false;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "WHATAPP_OPEN_INCOMING_CALL") openCallFromPush(event.data.signalId).catch((error) => toast(`Panggilan tidak dapat dibuka: ${error.message}`));
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForControllerChange) return;
    reloadedForControllerChange = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((registration) => registration.update()).catch(() => {});
  });
}
renderChats();
const sdkReady = cfg.SUPABASE_URL?.startsWith("https://") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
if (sdkReady) {
  $("loginBtn").disabled = true;
  $("signupBtn").disabled = true;
  $("authMessage").textContent = "Menghubungkan layanan akun…";
  loadSupabaseSdk()
    .then(() => initSupabase())
    .catch((error) => {
      $("loginBtn").disabled = false;
      $("signupBtn").disabled = false;
      $("authScreen").classList.remove("hidden");
      $("authMessage").textContent = `SDK akun gagal dimuat. Periksa koneksi lalu muat ulang. (${error.message})`;
    });
} else initSupabase();

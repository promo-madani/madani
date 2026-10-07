'use strict';
/*
 * One-to-one voice and video calls with screen sharing (WebRTC).
 * Audio and video go directly between the two computers over the office network;
 * the chat server only passes the short setup messages ("signals") between them.
 */
window.ChatCalls = (() => {
  const $ = (sel) => document.querySelector(sel);
  const RING_TIMEOUT = 40000;
  const tab = Math.random().toString(36).slice(2, 10);

  let ctx = null; // helpers from app.js
  let call = null; // the active or outgoing call
  let incoming = null; // a ringing incoming call
  let incomingTimer = null;
  let tone = null;

  // ---------- Sounds ----------

  function playTone(kind) {
    stopTone();
    let audio;
    try { audio = new AudioContext(); } catch { return; }
    const beep = (freq, start, length) => {
      const t = audio.currentTime + start;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(kind === 'ring' ? 0.18 : 0.06, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + length + 0.05);
    };
    const pattern = () => {
      if (kind === 'ring') { beep(880, 0, 0.35); beep(988, 0.4, 0.35); } else { beep(440, 0, 1); }
    };
    pattern();
    tone = { audio, timer: setInterval(pattern, kind === 'ring' ? 2000 : 3000) };
  }

  function stopTone() {
    if (!tone) return;
    clearInterval(tone.timer);
    tone.audio.close().catch(() => {});
    tone = null;
  }

  // ---------- Signals ----------

  function send(type, to, callId, extra = {}) {
    return ctx.api('/api/call/signal', { type, to, callId, tab, ...extra });
  }

  const signal = (type, extra) => send(type, call.peer, call.id, { kind: call.kind, ...extra });

  function onSignal(s) {
    if (!ctx) return;
    const me = ctx.me();
    if (s.from === me) {
      if (s.tab === tab) return;
      // I answered or declined on another device: stop ringing here.
      if ((s.type === 'accept' || s.type === 'decline') && incoming && incoming.callId === s.callId) hideIncoming();
      return;
    }
    if (s.to !== me) return;
    const mine = call && call.id === s.callId;
    switch (s.type) {
      case 'ring':
        if (call || incoming) { send('busy', s.from, s.callId).catch(() => {}); return; }
        showIncoming(s);
        break;
      case 'cancel':
        if (incoming && incoming.callId === s.callId) {
          hideIncoming();
          ctx.toast(`Missed ${s.kind} call from ${ctx.displayName(s.from)}`);
        }
        break;
      case 'accept':
        if (mine && call.role === 'caller' && call.state === 'ringing') startNegotiation().catch(fail);
        break;
      case 'decline':
      case 'busy':
        if (mine && call.state === 'ringing') {
          ctx.toast(s.type === 'busy' ? `${ctx.displayName(call.peer)} is on another call` : `${ctx.displayName(call.peer)} declined the call`);
          finish({ notify: false, status: s.type === 'busy' ? 'missed' : 'declined' });
        }
        break;
      case 'offer':
        if (mine && call.role === 'callee') answerOffer(s.data).catch(fail);
        break;
      case 'answer':
        if (mine && call.pc) call.pc.setRemoteDescription(s.data).then(flushIce).catch(fail);
        break;
      case 'ice':
        if (mine && s.data) addIce(s.data);
        break;
      case 'end':
        if (mine) {
          ctx.toast('Call ended');
          finish({ notify: false });
        }
        break;
    }
  }

  // ---------- Starting and answering ----------

  function secureCheck() {
    if (window.isSecureContext && navigator.mediaDevices && window.RTCPeerConnection) return true;
    ctx.needSecure('Calls');
    return false;
  }

  async function getMedia(kind) {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: kind === 'video' ? { width: 1280, height: 720 } : false });
    } catch (err) {
      if (kind === 'video') {
        // No camera (or it is busy): carry on with voice only.
        ctx.toast('Camera not available, starting with voice only');
        return navigator.mediaDevices.getUserMedia({ audio, video: false });
      }
      throw err;
    }
  }

  function mediaError(err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    ctx.toast(denied
      ? 'Microphone blocked. Click the 🔒 icon in the address bar and allow the microphone, then try again.'
      : 'No microphone found. Plug in your headphones/microphone and try again.');
  }

  async function start(peer, kind) {
    if (!secureCheck()) return;
    if (call || incoming) { ctx.toast('You are already in a call'); return; }
    const user = ctx.users().get(peer);
    if (!user || !user.online) { ctx.toast(`${ctx.displayName(peer)} is offline right now`); return; }
    call = newCall({ id: Math.random().toString(36).slice(2, 12), peer, kind, role: 'caller' });
    showPanel();
    setStatus('Starting…');
    try {
      call.local = await getMedia(kind);
    } catch (err) {
      mediaError(err);
      finish({ notify: false, log: false });
      return;
    }
    if (!call) return; // hung up meanwhile
    attachLocal();
    try {
      await signal('ring');
    } catch (err) {
      ctx.toast(err.message);
      finish({ notify: false, log: false });
      return;
    }
    setStatus('Calling…');
    playTone('ringback');
    call.ringTimer = setTimeout(() => {
      if (call && call.state === 'ringing') {
        signal('cancel').catch(() => {});
        ctx.toast(`${ctx.displayName(peer)} didn't answer`);
        finish({ notify: false, status: 'missed' });
      }
    }, RING_TIMEOUT);
  }

  function showIncoming(s) {
    incoming = s;
    const slot = $('#incomingAvatar');
    slot.textContent = '';
    slot.append(ctx.avatar(s.from, 'avatar lg'));
    $('#incomingName').textContent = ctx.displayName(s.from);
    $('#incomingKind').textContent = s.kind === 'video' ? 'Incoming video call…' : 'Incoming voice call…';
    $('#incomingCall').hidden = false;
    playTone('ring');
    ctx.notifyCall(s);
    incomingTimer = setTimeout(hideIncoming, RING_TIMEOUT + 5000);
  }

  function hideIncoming() {
    clearTimeout(incomingTimer);
    incoming = null;
    $('#incomingCall').hidden = true;
    stopTone();
  }

  async function accept() {
    if (!incoming) return;
    if (!secureCheck()) { decline(); return; }
    const s = incoming;
    hideIncoming();
    call = newCall({ id: s.callId, peer: s.from, kind: s.kind, role: 'callee' });
    call.state = 'connecting';
    showPanel();
    setStatus('Connecting…');
    try {
      call.local = await getMedia(s.kind);
    } catch (err) {
      mediaError(err);
      send('decline', s.from, s.callId).catch(() => {});
      finish({ notify: false, log: false });
      return;
    }
    attachLocal();
    createPeer();
    await send('accept', s.from, s.callId, { kind: s.kind }).catch(fail);
    ctx.openRoom(ctx.dmRoom(ctx.me(), s.from));
  }

  function decline() {
    if (!incoming) return;
    send('decline', incoming.from, incoming.callId).catch(() => {});
    hideIncoming();
  }

  // ---------- WebRTC ----------

  function newCall(fields) {
    return {
      ...fields, state: 'ringing', pc: null, local: null, remote: new MediaStream(),
      pendingIce: [], startedAt: 0, clock: null, ringTimer: null, screen: null, camera: null, videoSender: null,
    };
  }

  function createPeer() {
    // No STUN/TURN servers needed: both computers are on the same office network.
    const pc = new RTCPeerConnection({ iceServers: [] });
    call.pc = pc;
    pc.onicecandidate = (e) => { if (e.candidate && call) signal('ice', { data: e.candidate.toJSON() }).catch(() => {}); };
    pc.ontrack = (e) => {
      if (!call) return;
      call.remote.addTrack(e.track);
      $('#remoteAudio').srcObject = call.remote;
      if (e.track.kind === 'video') {
        const v = $('#remoteVideo');
        v.srcObject = call.remote;
        const update = () => showRemoteVideo(!e.track.muted && e.track.readyState === 'live');
        e.track.onmute = update;
        e.track.onunmute = update;
        e.track.onended = update;
        update();
      }
    };
    pc.onconnectionstatechange = () => {
      if (!call || call.pc !== pc) return;
      if (pc.connectionState === 'connected') {
        if (call.state !== 'active') {
          call.state = 'active';
          call.startedAt = Date.now();
          stopTone();
          call.clock = setInterval(tick, 1000);
        }
        tick();
      } else if (pc.connectionState === 'disconnected') {
        setStatus('Reconnecting…');
      } else if (pc.connectionState === 'failed') {
        ctx.toast('The call connection failed. Check both computers are on the office network.');
        finish({ notify: true });
      }
    };
    return pc;
  }

  async function startNegotiation() {
    clearTimeout(call.ringTimer);
    stopTone();
    call.state = 'connecting';
    setStatus('Connecting…');
    const pc = createPeer();
    const mic = call.local.getAudioTracks()[0];
    const cam = call.local.getVideoTracks()[0] || null;
    pc.addTransceiver(mic, { direction: 'sendrecv', streams: [call.local] });
    // Always include a video channel so camera and screen sharing can start later without renegotiating.
    const video = pc.addTransceiver(cam || 'video', { direction: 'sendrecv', streams: [call.local] });
    call.videoSender = video.sender;
    call.camera = cam;
    await pc.setLocalDescription(await pc.createOffer());
    await signal('offer', { data: pc.localDescription.toJSON() });
  }

  async function answerOffer(offer) {
    const pc = call.pc;
    await pc.setRemoteDescription(offer);
    const mic = call.local.getAudioTracks()[0];
    const cam = call.local.getVideoTracks()[0] || null;
    for (const t of pc.getTransceivers()) {
      t.direction = 'sendrecv';
      if (t.receiver.track.kind === 'audio') await t.sender.replaceTrack(mic);
      if (t.receiver.track.kind === 'video') {
        call.videoSender = t.sender;
        if (cam) await t.sender.replaceTrack(cam);
      }
    }
    call.camera = cam;
    await pc.setLocalDescription(await pc.createAnswer());
    await signal('answer', { data: pc.localDescription.toJSON() });
    flushIce();
  }

  function addIce(candidate) {
    if (call.pc && call.pc.remoteDescription) call.pc.addIceCandidate(candidate).catch(() => {});
    else call.pendingIce.push(candidate);
  }

  function flushIce() {
    if (!call || !call.pc) return;
    for (const c of call.pendingIce.splice(0)) call.pc.addIceCandidate(c).catch(() => {});
  }

  function fail(err) {
    console.error(err);
    if (call) {
      ctx.toast(`Call problem: ${err.message || err}`);
      finish({ notify: true });
    }
  }

  // ---------- In-call controls ----------

  function toggleMic() {
    if (!call || !call.local) return;
    const track = call.local.getAudioTracks()[0];
    track.enabled = !track.enabled;
    updateControls();
  }

  async function toggleCamera() {
    if (!call || !call.videoSender || call.screen) return;
    if (call.camera) {
      call.camera.stop();
      call.local.removeTrack(call.camera);
      call.camera = null;
      await call.videoSender.replaceTrack(null);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        call.camera = stream.getVideoTracks()[0];
        call.local.addTrack(call.camera);
        await call.videoSender.replaceTrack(call.camera);
      } catch {
        ctx.toast('Camera not available');
      }
    }
    attachLocal();
    updateControls();
  }

  async function toggleScreen() {
    if (!call || !call.videoSender) return;
    if (call.screen) {
      stopScreen();
      return;
    }
    if (!navigator.mediaDevices.getDisplayMedia) { ctx.toast('Screen sharing is not supported in this browser'); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      call.screen = stream.getVideoTracks()[0];
      call.screen.contentHint = 'detail';
      call.screen.onended = stopScreen;
      await call.videoSender.replaceTrack(call.screen);
      attachLocal();
      updateControls();
    } catch { /* picker cancelled */ }
  }

  function stopScreen() {
    if (!call || !call.screen) return;
    call.screen.stop();
    call.screen = null;
    call.videoSender.replaceTrack(call.camera || null).catch(() => {});
    attachLocal();
    updateControls();
  }

  function hangUp() {
    if (!call) return;
    if (call.state === 'ringing' && call.role === 'caller') {
      signal('cancel').catch(() => {});
      finish({ notify: false, status: 'missed' });
    } else {
      finish({ notify: true });
    }
  }

  function finish({ notify = true, status = null, log = true } = {}) {
    if (!call) return;
    const c = call;
    call = null;
    if (notify) send('end', c.peer, c.id, { kind: c.kind }).catch(() => {});
    clearTimeout(c.ringTimer);
    clearInterval(c.clock);
    stopTone();
    for (const t of [...(c.local ? c.local.getTracks() : []), c.screen, c.camera]) if (t) t.stop();
    if (c.pc) c.pc.close();
    $('#remoteAudio').srcObject = null;
    $('#remoteVideo').srcObject = null;
    $('#localVideo').srcObject = null;
    $('#callPanel').hidden = true;
    $('#callPanel').classList.remove('big');
    // The caller writes the call into the chat history.
    if (log && c.role === 'caller') {
      const duration = c.startedAt ? (Date.now() - c.startedAt) / 1000 : 0;
      ctx.api('/api/call/log', { to: c.peer, kind: c.kind, status: c.startedAt ? 'completed' : (status || 'missed'), duration })
        .then(ctx.addMessage).catch(() => {});
    }
  }

  // ---------- Call window ----------

  function showPanel() {
    const avatarSlot = $('#remoteAvatar');
    avatarSlot.textContent = '';
    avatarSlot.append(ctx.avatar(call.peer, 'avatar xl'));
    $('#callName').textContent = ctx.displayName(call.peer);
    showRemoteVideo(false);
    $('#callPanel').hidden = false;
    updateControls();
  }

  function showRemoteVideo(on) {
    $('#remoteVideo').hidden = !on;
    $('#remoteAvatar').hidden = on;
    $('#callPanel').classList.toggle('has-video', on);
  }

  function attachLocal() {
    if (!call) return;
    const v = $('#localVideo');
    const track = call.screen || call.camera || (call.local && call.local.getVideoTracks()[0]);
    if (track) {
      v.srcObject = new MediaStream([track]);
      v.hidden = false;
      v.classList.toggle('mirror', !call.screen);
    } else {
      v.srcObject = null;
      v.hidden = true;
    }
  }

  function setStatus(text) {
    $('#callStatus').textContent = text;
  }

  function tick() {
    if (!call || call.state !== 'active') return;
    const s = Math.floor((Date.now() - call.startedAt) / 1000);
    setStatus(`${call.screen ? 'Sharing screen · ' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }

  function updateControls() {
    if (!call) return;
    const micOn = call.local ? call.local.getAudioTracks().some((t) => t.enabled) : true;
    const mic = $('#micToggle');
    mic.classList.toggle('off', !micOn);
    mic.title = micOn ? 'Mute microphone' : 'Unmute microphone';
    const cam = $('#camToggle');
    cam.classList.toggle('off', !call.camera);
    cam.title = call.camera ? 'Turn camera off' : 'Turn camera on';
    cam.disabled = Boolean(call.screen);
    const share = $('#shareToggle');
    share.classList.toggle('active', Boolean(call.screen));
    share.title = call.screen ? 'Stop sharing your screen' : 'Share your screen';
    tick();
  }

  // ---------- Setup ----------

  function init(context) {
    ctx = context;
    $('#acceptBtn').addEventListener('click', accept);
    $('#declineBtn').addEventListener('click', decline);
    $('#hangupBtn').addEventListener('click', hangUp);
    $('#micToggle').addEventListener('click', toggleMic);
    $('#camToggle').addEventListener('click', toggleCamera);
    $('#shareToggle').addEventListener('click', toggleScreen);
    $('#sizeToggle').addEventListener('click', () => $('#callPanel').classList.toggle('big'));
    // Closing the tab during a call hangs up properly.
    window.addEventListener('pagehide', () => {
      if (!call) return;
      fetch('/api/call/signal', {
        method: 'POST', keepalive: true, credentials: 'same-origin',
        headers: { 'X-Chat': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: call.state === 'ringing' ? 'cancel' : 'end', to: call.peer, callId: call.id, tab }),
      }).catch(() => {});
    });
  }

  return { init, start, onSignal, inCall: () => Boolean(call), tab };
})();

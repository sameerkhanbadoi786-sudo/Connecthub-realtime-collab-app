// room.js (frontend)
// Handles: auth guard, Socket.io connection, WebRTC mesh (multi-peer),
// screen sharing, mic/cam toggles, file sharing, chat,
// room creator controls, and kicking participants.

// ---------- Auth guard ----------


const token = localStorage.getItem('token');
const username = localStorage.getItem('username');
const API_URL =
  'https://connecthub-realtime-collab-app-production.up.railway.app';

if (!token || !username) {
  window.location.href = '/index.html';
}

const params = new URLSearchParams(window.location.search);
const roomId = params.get('room') || 'default-room';

document.getElementById('room-id-display').textContent = roomId;
document.getElementById('username-display').textContent = username;
document.getElementById('avatar-initial').textContent =
  username.charAt(0).toUpperCase();

document.getElementById('copy-room-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href);

  const btn = document.getElementById('copy-room-btn');
  const original = btn.textContent;

  btn.textContent = 'Copied!';

  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
});

// ---------- Socket.io connection ----------

const socket = io(API_URL, {
  auth: { token },
});

// ---------- Room owner ----------

// Socket ID of the room creator
let ownerSocketId = null;

// True only for the room creator
let isRoomOwner = false;

// ---------- ICE configuration ----------

let ICE_SERVERS = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302',
    },
  ],
};

async function loadIceConfig() {
  try {
    const res = await fetch(`${API_URL}/api/ice-config`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.ok) {
      ICE_SERVERS = await res.json();
    }
  } catch {
    // Keep STUN-only fallback
  }
}

// ---------- Media state ----------

let localStream = null;
let screenStream = null;

// socketId -> RTCPeerConnection
const peerConnections = new Map();

// socketId -> username
const peerUsernames = new Map();

const videoGrid = document.getElementById('video-grid');

// ---------- Initialization ----------

async function init() {
  await loadIceConfig();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
  } catch (err) {
    alert(
      'Could not access camera/microphone: ' +
        err.message
    );

    // Empty stream fallback
    localStream = new MediaStream();
  }

  addVideoTile(
    'local',
    'You',
    localStream,
    true
  );

  attachSpeakingDetector(
    localStream,
    'local'
  );

  socket.emit('join-room', {
    roomId,
  });
}

// ---------- Video tiles ----------

function addVideoTile(
  id,
  label,
  stream,
  isLocal = false
) {
  removeVideoTile(id);

  const tile = document.createElement('div');

  tile.className = 'video-tile';
  tile.id = `tile-${id}`;

  const video = document.createElement('video');

  video.autoplay = true;
  video.playsInline = true;

  if (isLocal) {
    video.muted = true;
  }

  video.srcObject = stream;

  const labelEl = document.createElement('div');

  labelEl.className = 'label';

  const dot = document.createElement('span');

  dot.className = 'live-dot';

  labelEl.appendChild(dot);

  labelEl.appendChild(
    document.createTextNode(label)
  );

  tile.appendChild(video);
  tile.appendChild(labelEl);

  // IMPORTANT:
  // For remote users, id is their socket ID.
  tile.appendChild(
    buildTileControls(
      tile,
      video,
      isLocal,
      isLocal ? null : id
    )
  );

  videoGrid.appendChild(tile);
}

// ---------- Per-tile controls ----------

function buildTileControls(
  tile,
  video,
  isLocal,
  remoteSocketId = null
) {
  const controls = document.createElement('div');

  controls.className = 'tile-controls';

  // --------------------------------------------------
  // LOCAL USER
  // --------------------------------------------------

  if (isLocal) {
    const fsBtn = document.createElement('button');

    fsBtn.type = 'button';
    fsBtn.className = 'tile-btn';
    fsBtn.title = 'Full screen';
    fsBtn.setAttribute(
      'aria-label',
      'Full screen'
    );

    fsBtn.innerHTML = ICON_EXPAND;

    fsBtn.addEventListener('click', () => {
      toggleTileFullscreen(
        tile,
        fsBtn
      );
    });

    controls.appendChild(fsBtn);

    return controls;
  }

  // --------------------------------------------------
  // REMOTE USER - MUTE FOR ME
  // --------------------------------------------------

  const muteBtn = document.createElement('button');

  muteBtn.type = 'button';
  muteBtn.className = 'tile-btn';
  muteBtn.title = 'Mute for me';
  muteBtn.setAttribute(
    'aria-label',
    'Mute for me'
  );

  muteBtn.innerHTML = ICON_SPEAKER_ON;

  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;

    muteBtn.classList.toggle(
      'is-off',
      video.muted
    );

    muteBtn.innerHTML = video.muted
      ? ICON_SPEAKER_OFF
      : ICON_SPEAKER_ON;

    muteBtn.title = video.muted
      ? 'Unmute for me'
      : 'Mute for me';

    muteBtn.setAttribute(
      'aria-label',
      muteBtn.title
    );
  });

  controls.appendChild(muteBtn);

  // --------------------------------------------------
  // FULLSCREEN
  // --------------------------------------------------

  const fsBtn = document.createElement('button');

  fsBtn.type = 'button';
  fsBtn.className = 'tile-btn';
  fsBtn.title = 'Full screen';
  fsBtn.setAttribute(
    'aria-label',
    'Full screen'
  );

  fsBtn.innerHTML = ICON_EXPAND;

  fsBtn.addEventListener('click', () => {
    toggleTileFullscreen(
      tile,
      fsBtn
    );
  });

  controls.appendChild(fsBtn);

  // --------------------------------------------------
  // KICK BUTTON
  //
  // Only the room creator gets this button.
  // Joiners will NOT see it.
  // --------------------------------------------------

  if (
    isRoomOwner &&
    remoteSocketId &&
    remoteSocketId !== socket.id
  ) {
    const kickBtn = document.createElement('button');

    kickBtn.type = 'button';

    kickBtn.className =
      'tile-btn kick-btn';

    kickBtn.title = 'Kick user';

    kickBtn.setAttribute(
      'aria-label',
      'Kick user'
    );

    kickBtn.textContent = 'Kick';

    kickBtn.addEventListener('click', () => {
      const targetName =
        peerUsernames.get(remoteSocketId) ||
        'this user';

      const confirmed = confirm(
        `Kick ${targetName} from the room?`
      );

      if (!confirmed) {
        return;
      }

      socket.emit('kick-user', {
        roomId,
        targetSocketId: remoteSocketId,
      });
    });

    controls.appendChild(kickBtn);
  }

  return controls;
}

// ---------- Fullscreen ----------

function toggleTileFullscreen(
  tile,
  fsBtn
) {
  if (
    document.fullscreenElement === tile
  ) {
    document.exitFullscreen();
    return;
  }

  if (tile.requestFullscreen) {
    tile
      .requestFullscreen()
      .catch(() => {});
  }
}

document.addEventListener(
  'fullscreenchange',
  () => {
    document
      .querySelectorAll('.video-tile')
      .forEach((tile) => {
        tile.classList.toggle(
          'is-fullscreen',
          document.fullscreenElement === tile
        );
      });
  }
);

// ---------- Icons ----------

const ICON_SPEAKER_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 8a5 5 0 0 1 0 8"/></svg>';

const ICON_SPEAKER_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><line x1="16" y1="9" x2="21" y2="14"/><line x1="21" y1="9" x2="16" y2="14"/></svg>';

const ICON_EXPAND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

// ---------- Remove video tile ----------

function removeVideoTile(id) {
  const existing =
    document.getElementById(
      `tile-${id}`
    );

  if (existing) {
    existing.remove();
  }
}

// ---------- Speaking detector ----------

let sharedAudioCtx = null;

function getAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx =
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();
  }

  return sharedAudioCtx;
}

function attachSpeakingDetector(
  stream,
  tileId
) {
  const audioTracks =
    stream.getAudioTracks();

  if (!audioTracks.length) {
    return;
  }

  const ctx = getAudioContext();

  const source =
    ctx.createMediaStreamSource(
      stream
    );

  const analyser =
    ctx.createAnalyser();

  analyser.fftSize = 512;

  source.connect(analyser);

  const data = new Uint8Array(
    analyser.frequencyBinCount
  );

  const THRESHOLD = 14;

  function tick() {
    const tile =
      document.getElementById(
        `tile-${tileId}`
      );

    if (!tile) {
      return;
    }

    analyser.getByteFrequencyData(data);

    const avg =
      data.reduce(
        (sum, v) => sum + v,
        0
      ) / data.length;

    tile.classList.toggle(
      'speaking',
      avg > THRESHOLD
    );

    requestAnimationFrame(tick);
  }

  tick();
}

// ---------- WebRTC ----------

function createPeerConnection(
  remoteSocketId,
  remoteUsername
) {
  const pc =
    new RTCPeerConnection(
      ICE_SERVERS
    );

  peerConnections.set(
    remoteSocketId,
    pc
  );

  peerUsernames.set(
    remoteSocketId,
    remoteUsername
  );

  localStream
    .getTracks()
    .forEach((track) => {
      pc.addTrack(
        track,
        localStream
      );
    });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', {
        to: remoteSocketId,
        data: {
          type: 'ice-candidate',
          candidate: event.candidate,
        },
      });
    }
  };

  pc.ontrack = (event) => {
    addVideoTile(
      remoteSocketId,
      remoteUsername,
      event.streams[0]
    );

    attachSpeakingDetector(
      event.streams[0],
      remoteSocketId
    );
  };

  pc.onconnectionstatechange =
    () => {
      if (
        [
          'disconnected',
          'failed',
          'closed',
        ].includes(
          pc.connectionState
        )
      ) {
        removeVideoTile(
          remoteSocketId
        );
      }
    };

  return pc;
}

async function callPeer(
  remoteSocketId,
  remoteUsername
) {
  const pc =
    createPeerConnection(
      remoteSocketId,
      remoteUsername
    );

  const offer =
    await pc.createOffer();

  await pc.setLocalDescription(
    offer
  );

  socket.emit('signal', {
    to: remoteSocketId,
    data: {
      type: 'offer',
      sdp: offer,
    },
  });
}

// ---------- Room owner information ----------

socket.on(
  'room-info',
  ({ ownerSocketId: ownerId }) => {
    ownerSocketId = ownerId;

    isRoomOwner =
      socket.id === ownerSocketId;

    console.log(
      isRoomOwner
        ? 'You are the room creator.'
        : 'You are a room participant.'
    );

    // Rebuild existing remote tiles
    // so the Kick button appears for
    // the creator when necessary.
    peerConnections.forEach(
      (pc, remoteSocketId) => {
        const tile =
          document.getElementById(
            `tile-${remoteSocketId}`
          );

        if (!tile) {
          return;
        }

        const video =
          tile.querySelector('video');

        if (!video) {
          return;
        }

        const remoteUsername =
          peerUsernames.get(
            remoteSocketId
          ) || 'User';

        const stream =
          video.srcObject;

        addVideoTile(
          remoteSocketId,
          remoteUsername,
          stream,
          false
        );
      }
    );
  }
);

// ---------- Existing peers ----------

socket.on(
  'existing-peers',
  (peers) => {
    peers.forEach(
      ({
        socketId,
        username: uname,
      }) => {
        peerUsernames.set(
          socketId,
          uname
        );

        callPeer(
          socketId,
          uname
        );
      }
    );
  }
);

// ---------- New peer joined ----------

socket.on(
  'user-joined',
  ({
    socketId,
    username: uname,
  }) => {
    peerUsernames.set(
      socketId,
      uname
    );
  }
);

// ---------- WebRTC signaling ----------

socket.on(
  'signal',
  async ({
    from,
    username: fromUsername,
    data,
  }) => {
    let pc =
      peerConnections.get(from);

    if (data.type === 'offer') {
      if (!pc) {
        pc =
          createPeerConnection(
            from,
            fromUsername
          );
      }

      await pc.setRemoteDescription(
        new RTCSessionDescription(
          data.sdp
        )
      );

      const answer =
        await pc.createAnswer();

      await pc.setLocalDescription(
        answer
      );

      socket.emit('signal', {
        to: from,
        data: {
          type: 'answer',
          sdp: answer,
        },
      });
    } else if (
      data.type === 'answer'
    ) {
      if (pc) {
        await pc.setRemoteDescription(
          new RTCSessionDescription(
            data.sdp
          )
        );
      }
    } else if (
      data.type === 'ice-candidate'
    ) {
      if (pc) {
        try {
          await pc.addIceCandidate(
            data.candidate
          );
        } catch (err) {
          console.warn(
            'Failed to add ICE candidate',
            err
          );
        }
      }
    }
  }
);

// ---------- User left ----------

socket.on(
  'user-left',
  ({ socketId }) => {
    const pc =
      peerConnections.get(
        socketId
      );

    if (pc) {
      pc.close();
    }

    peerConnections.delete(
      socketId
    );

    peerUsernames.delete(
      socketId
    );

    removeVideoTile(
      socketId
    );
  }
);

// ---------- Kicked from room ----------

socket.on(
  'kicked',
  ({ reason }) => {
    alert(
      reason ||
        'You were removed from the room.'
    );

    // Close all peer connections
    peerConnections.forEach(
      (pc) => pc.close()
    );

    peerConnections.clear();
    peerUsernames.clear();

    // Stop camera/microphone
    if (localStream) {
      localStream
        .getTracks()
        .forEach((track) =>
          track.stop()
        );
    }

    // Stop screen sharing
    if (screenStream) {
      screenStream
        .getTracks()
        .forEach((track) =>
          track.stop()
        );

      screenStream = null;
    }

    socket.disconnect();

    window.location.href =
      '/lobby.html';
  }
);

// ---------- Kick error ----------

socket.on(
  'kick-error',
  ({ error }) => {
    alert(
      error ||
        'Could not kick the user.'
    );
  }
);

// ---------- Mic / Camera ----------

let micOn = true;
let camOn = true;

const micBtn =
  document.getElementById(
    'toggle-mic'
  );

const camBtn =
  document.getElementById(
    'toggle-cam'
  );

micBtn.addEventListener(
  'click',
  () => {
    micOn = !micOn;

    localStream
      .getAudioTracks()
      .forEach(
        (t) =>
          (t.enabled = micOn)
      );

    micBtn.classList.toggle(
      'is-off',
      !micOn
    );

    micBtn.setAttribute(
      'aria-label',
      micOn
        ? 'Mute microphone'
        : 'Unmute microphone'
    );

    micBtn.title = micOn
      ? 'Mute microphone'
      : 'Unmute microphone';
  }
);

camBtn.addEventListener(
  'click',
  () => {
    camOn = !camOn;

    localStream
      .getVideoTracks()
      .forEach(
        (t) =>
          (t.enabled = camOn)
      );

    camBtn.classList.toggle(
      'is-off',
      !camOn
    );

    camBtn.setAttribute(
      'aria-label',
      camOn
        ? 'Turn off camera'
        : 'Turn on camera'
    );

    camBtn.title = camOn
      ? 'Turn off camera'
      : 'Turn on camera';
  }
);

// ---------- Screen sharing ----------

const screenBtn =
  document.getElementById(
    'toggle-screen'
  );

screenBtn.addEventListener(
  'click',
  async () => {
    if (!screenStream) {
      try {
        screenStream =
          await navigator.mediaDevices.getDisplayMedia(
            {
              video: true,
            }
          );
      } catch {
        return;
      }

      const screenTrack =
        screenStream.getVideoTracks()[0];

      peerConnections.forEach(
        (pc) => {
          const sender =
            pc
              .getSenders()
              .find(
                (s) =>
                  s.track &&
                  s.track.kind ===
                    'video'
              );

          if (sender) {
            sender.replaceTrack(
              screenTrack
            );
          }
        }
      );

      addVideoTile(
        'local',
        'You (screen)',
        screenStream,
        true
      );

      screenBtn.classList.add(
        'is-active'
      );

      screenBtn.title =
        'Stop sharing';

      screenBtn.setAttribute(
        'aria-label',
        'Stop sharing'
      );

      socket.emit(
        'screen-share-status',
        {
          roomId,
          sharing: true,
        }
      );

      screenTrack.onended =
        () => stopScreenShare();
    } else {
      stopScreenShare();
    }
  }
);

function stopScreenShare() {
  if (screenStream) {
    screenStream
      .getTracks()
      .forEach((t) =>
        t.stop()
      );

    screenStream = null;
  }

  const camTrack =
    localStream.getVideoTracks()[0];

  peerConnections.forEach(
    (pc) => {
      const sender =
        pc
          .getSenders()
          .find(
            (s) =>
              s.track &&
              s.track.kind ===
                'video'
          );

      if (
        sender &&
        camTrack
      ) {
        sender.replaceTrack(
          camTrack
        );
      }
    }
  );

  addVideoTile(
    'local',
    'You',
    localStream,
    true
  );

  attachSpeakingDetector(
    localStream,
    'local'
  );

  screenBtn.classList.remove(
    'is-active'
  );

  screenBtn.title =
    'Share screen';

  screenBtn.setAttribute(
    'aria-label',
    'Share screen'
  );

  socket.emit(
    'screen-share-status',
    {
      roomId,
      sharing: false,
    }
  );
}

// ---------- Side panel ----------

const sidePanel =
  document.getElementById(
    'side-panel'
  );

const sideTabs = {
  whiteboard:
    document.getElementById(
      'side-tab-whiteboard'
    ),

  files:
    document.getElementById(
      'side-tab-files'
    ),

  chat:
    document.getElementById(
      'side-tab-chat'
    ),
};

const sidePanels = {
  whiteboard:
    document.getElementById(
      'whiteboard-panel'
    ),

  files:
    document.getElementById(
      'files-panel'
    ),

  chat:
    document.getElementById(
      'chat-panel'
    ),
};

const dockPanelButtons = {
  whiteboard:
    document.getElementById(
      'toggle-whiteboard'
    ),

  files:
    document.getElementById(
      'toggle-files'
    ),
};

function showSidePanel(
  which
) {
  sidePanel.classList.remove(
    'hidden'
  );

  Object.keys(sideTabs).forEach(
    (key) => {
      sideTabs[key].classList.toggle(
        'active',
        key === which
      );

      sidePanels[key].classList.toggle(
        'hidden',
        key !== which
      );
    }
  );

  Object.keys(
    dockPanelButtons
  ).forEach((key) => {
    dockPanelButtons[
      key
    ].classList.toggle(
      'panel-active',
      key === which
    );
  });
}

document
  .getElementById(
    'toggle-whiteboard'
  )
  .addEventListener(
    'click',
    () =>
      showSidePanel(
        'whiteboard'
      )
  );

document
  .getElementById(
    'toggle-files'
  )
  .addEventListener(
    'click',
    () =>
      showSidePanel('files')
  );

sideTabs.whiteboard.addEventListener(
  'click',
  () =>
    showSidePanel('whiteboard')
);

sideTabs.files.addEventListener(
  'click',
  () =>
    showSidePanel('files')
);

sideTabs.chat.addEventListener(
  'click',
  () =>
    showSidePanel('chat')
);

// ---------- File sharing ----------

const fileInput =
  document.getElementById(
    'file-input'
  );

const fileList =
  document.getElementById(
    'file-list'
  );

fileInput.addEventListener(
  'change',
  async () => {
    const file =
      fileInput.files[0];

    if (!file) {
      return;
    }

    const formData =
      new FormData();

    formData.append(
      'file',
      file
    );

    try {
      const res = await fetch(`${API_URL}/api/upload`, {
            method: 'POST',
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
            body: formData,
          }
        );

      const data =
        await res.json();

      if (!res.ok) {
        throw new Error(
          data.error ||
            'Upload failed'
        );
      }

      addFileToList(
        data.fileName,
        data.url,
        username
      );

      socket.emit(
        'file-shared',
        {
          roomId,
          file: data,
        }
      );
    } catch (err) {
      alert(
        'File upload failed: ' +
          err.message
      );
    } finally {
      fileInput.value = '';
    }
  }
);

socket.on(
  'file-shared',
  (file) => {
    addFileToList(
      file.fileName,
      file.url,
      file.sharedBy
    );
  }
);

function addFileToList(
  name,
  url,
  sharedBy
) {
  const li =
    document.createElement('li');

  const a =
    document.createElement('a');

  a.href = url;
  a.target = '_blank';
  a.textContent = name;

  li.appendChild(a);

  const meta =
    document.createElement(
      'div'
    );

  meta.style.color =
    'var(--muted)';

  meta.style.fontSize =
    '11px';

  meta.textContent =
    `shared by ${sharedBy}`;

  li.appendChild(meta);

  fileList.prepend(li);
}

// ---------- Chat ----------

const chatForm =
  document.getElementById(
    'chat-form'
  );

const chatInput =
  document.getElementById(
    'chat-input'
  );

const chatList =
  document.getElementById(
    'chat-list'
  );

const emojiBtn =
  document.getElementById(
    'emoji-btn'
  );

const emojiPicker =
  document.getElementById(
    'emoji-picker'
  );

const mentionDropdown =
  document.getElementById(
    'mention-dropdown'
  );

const EMOJIS = [
  '😀',
  '😂',
  '😅',
  '😊',
  '😍',
  '😘',
  '😜',
  '🤔',
  '😎',
  '🙄',
  '😴',
  '😭',
  '😢',
  '😡',
  '🥳',
  '😱',
  '👍',
  '👎',
  '👏',
  '🙌',
  '🙏',
  '💪',
  '👋',
  '✋',
  '❤️',
  '🔥',
  '🎉',
  '✅',
  '❌',
  '⭐',
  '💡',
  '📌',
  '🚀',
  '👀',
  '😇',
  '🤝',
];

emojiPicker.innerHTML =
  EMOJIS.map(
    (e) =>
      `<button type="button">${e}</button>`
  ).join('');

emojiBtn.addEventListener(
  'click',
  (e) => {
    e.stopPropagation();

    mentionDropdown.classList.add(
      'hidden'
    );

    emojiPicker.classList.toggle(
      'hidden'
    );
  }
);

emojiPicker.addEventListener(
  'click',
  (e) => {
    const btn =
      e.target.closest(
        'button'
      );

    if (!btn) {
      return;
    }

    insertAtCursor(
      chatInput,
      btn.textContent
    );

    chatInput.focus();
  }
);

document.addEventListener(
  'click',
  (e) => {
    if (
      !emojiPicker.contains(e.target) &&
      !emojiBtn.contains(e.target)
    ) {
      emojiPicker.classList.add(
        'hidden'
      );
    }

    if (
      !mentionDropdown.contains(
        e.target
      ) &&
      e.target !== chatInput
    ) {
      mentionDropdown.classList.add(
        'hidden'
      );
    }
  }
);

function insertAtCursor(
  input,
  text
) {
  const start =
    input.selectionStart ??
    input.value.length;

  const end =
    input.selectionEnd ??
    input.value.length;

  input.value =
    input.value.slice(
      0,
      start
    ) +
    text +
    input.value.slice(end);

  const cursor =
    start + text.length;

  input.setSelectionRange(
    cursor,
    cursor
  );
}

// ---------- @mentions ----------

let mentionMatches = [];
let mentionActiveIndex = -1;
let mentionRange = null;

function currentRoomUsernames() {
  const names = new Set([
    username,
    ...peerUsernames.values(),
  ]);

  return Array.from(names);
}

function updateMentionDropdown() {
  const cursor =
    chatInput.selectionStart;

  const before =
    chatInput.value.slice(
      0,
      cursor
    );

  const match =
    before.match(
      /(?:^|\s)@([a-zA-Z0-9_]{0,20})$/
    );

  if (!match) {
    mentionDropdown.classList.add(
      'hidden'
    );

    mentionRange = null;

    return;
  }

  const query =
    match[1].toLowerCase();

  mentionMatches =
    currentRoomUsernames().filter(
      (u) =>
        u
          .toLowerCase()
          .startsWith(query)
    );

  mentionRange = {
    start:
      cursor -
      match[1].length,

    end: cursor,
  };

  if (
    mentionMatches.length === 0
  ) {
    mentionDropdown.classList.add(
      'hidden'
    );

    return;
  }

  mentionActiveIndex = 0;

  renderMentionDropdown();

  mentionDropdown.classList.remove(
    'hidden'
  );

  emojiPicker.classList.add(
    'hidden'
  );
}

function renderMentionDropdown() {
  mentionDropdown.innerHTML =
    mentionMatches
      .map(
        (u, i) =>
          `<div class="mention-item${
            i === mentionActiveIndex
              ? ' active'
              : ''
          }" data-username="${escapeHtml(
            u
          )}">
            <span class="avatar-dot">${escapeHtml(
              u.charAt(0).toUpperCase()
            )}</span>${escapeHtml(u)}
          </div>`
      )
      .join('');
}

function applyMention(name) {
  if (!mentionRange) {
    return;
  }

  const before =
    chatInput.value.slice(
      0,
      mentionRange.start
    );

  const after =
    chatInput.value.slice(
      mentionRange.end
    );

  const insertion =
    `@${name} `;

  chatInput.value =
    before +
    insertion +
    after;

  const cursor =
    before.length +
    insertion.length;

  chatInput.setSelectionRange(
    cursor,
    cursor
  );

  mentionDropdown.classList.add(
    'hidden'
  );

  mentionRange = null;

  chatInput.focus();
}

chatInput.addEventListener(
  'input',
  updateMentionDropdown
);

chatInput.addEventListener(
  'keydown',
  (e) => {
    if (
      mentionDropdown.classList.contains(
        'hidden'
      )
    ) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();

      mentionActiveIndex =
        (mentionActiveIndex + 1) %
        mentionMatches.length;

      renderMentionDropdown();
    } else if (
      e.key === 'ArrowUp'
    ) {
      e.preventDefault();

      mentionActiveIndex =
        (mentionActiveIndex -
          1 +
          mentionMatches.length) %
        mentionMatches.length;

      renderMentionDropdown();
    } else if (
      e.key === 'Enter' ||
      e.key === 'Tab'
    ) {
      e.preventDefault();

      applyMention(
        mentionMatches[
          mentionActiveIndex
        ]
      );
    } else if (
      e.key === 'Escape'
    ) {
      mentionDropdown.classList.add(
        'hidden'
      );
    }
  }
);

mentionDropdown.addEventListener(
  'click',
  (e) => {
    const item =
      e.target.closest(
        '.mention-item'
      );

    if (item) {
      applyMention(
        item.dataset.username
      );
    }
  }
);

// ---------- Chat send / receive ----------

chatForm.addEventListener(
  'submit',
  (e) => {
    e.preventDefault();

    const message =
      chatInput.value.trim();

    if (!message) {
      return;
    }

    socket.emit(
      'chat-message',
      {
        roomId,
        message,
      }
    );

    chatInput.value = '';

    emojiPicker.classList.add(
      'hidden'
    );

    mentionDropdown.classList.add(
      'hidden'
    );
  }
);

socket.on(
  'chat-message',
  ({
    username: from,
    message,
  }) => {
    const mentionsMe =
      new RegExp(
        `(^|\\s)@${escapeRegex(
          username
        )}\\b`,
        'i'
      ).test(message);

    const li =
      document.createElement(
        'li'
      );

    if (mentionsMe) {
      li.classList.add(
        'mention-me'
      );
    }

    li.innerHTML =
      `<strong>${escapeHtml(
        from
      )}:</strong> ${formatMessage(
        message
      )}`;

    chatList.appendChild(li);

    chatList.scrollTop =
      chatList.scrollHeight;
  }
);

function formatMessage(
  message
) {
  const escaped =
    escapeHtml(message);

  return escaped.replace(
    /(^|\s)@([a-zA-Z0-9_]{3,20})\b/g,
    (
      full,
      lead,
      name
    ) => {
      return `${lead}<span class="mention">@${name}</span>`;
    }
  );
}

function escapeRegex(str) {
  return str.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
}

function escapeHtml(str) {
  const div =
    document.createElement(
      'div'
    );

  div.textContent = str;

  return div.innerHTML;
}

// ---------- Leave ----------

document
  .getElementById('leave-btn')
  .addEventListener(
    'click',
    () => {
      socket.emit(
        'leave-room'
      );

      peerConnections.forEach(
        (pc) => pc.close()
      );

      if (localStream) {
        localStream
          .getTracks()
          .forEach((t) =>
            t.stop()
          );
      }

      if (screenStream) {
        screenStream
          .getTracks()
          .forEach((t) =>
            t.stop()
          );
      }

      window.location.href =
        '/lobby.html';
    }
  );

// ---------- Start ----------

init();
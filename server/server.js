// server.js
// Entry point: Express REST API + Socket.io real-time signaling server.
//
// Responsibilities:
//   - Serve the frontend (public/)
//   - REST auth routes (/api/auth/*)
//   - REST file upload route (/api/upload), protected by JWT
//   - Socket.io: room presence, WebRTC signaling relay, whiteboard sync,
//     file-share broadcast, chat, room-owner controls

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const { router: authRouter, JWT_SECRET } = require('./auth');
const { requireAuth } = require('./middleware');

const app = express();

// ---------- CORS origin ----------
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : '*';

if (CORS_ORIGIN === '*' && process.env.NODE_ENV === 'production') {
  console.warn(
    'CORS_ORIGIN is not set - allowing requests from any origin in production. ' +
    'Set CORS_ORIGIN to your real frontend URL(s) before going live.'
  );
}

const corsOptions = { origin: CORS_ORIGIN };

// ---------- Transport: HTTPS/WSS if a local cert exists ----------
const CERT_DIR = path.join(__dirname, 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

const hasCerts = fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH);

let server;

if (hasCerts) {
  const tlsOptions = {
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH),
  };

  server = https.createServer(tlsOptions, app);

  console.log('TLS cert found - serving over HTTPS/WSS.');
} else {
  server = http.createServer(app);

  console.warn(
    'No TLS cert found - serving over plain HTTP/WS (fine for local dev only).\n' +
    'Run "npm run certs" to generate a local self-signed cert and enable HTTPS/WSS.'
  );
}

const io = new Server(server, {
  cors: corsOptions,
});

const PORT = process.env.PORT || 3000;

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- REST: Auth ----------

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

app.use('/api/auth', authLimiter, authRouter);

// ---------- REST: File upload ----------

const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),

  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${uuidv4()}${path.extname(
      file.originalname
    )}`;

    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

app.use('/uploads', express.static(UPLOAD_DIR));

app.post(
  '/api/upload',
  requireAuth,
  upload.single('file'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded.',
      });
    }

    res.json({
      fileName: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size,
      uploadedBy: req.user.username,
    });
  }
);

// ---------- REST: ICE server config ----------

let cachedMeteredIce = null;
let cachedMeteredIceExpiry = 0;

const METERED_CACHE_MS = 6 * 60 * 60 * 1000;

app.get('/api/ice-config', requireAuth, async (req, res) => {
  const iceServers = [
    {
      urls: 'stun:stun.l.google.com:19302',
    },
  ];

  if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
    try {
      if (
        !cachedMeteredIce ||
        Date.now() > cachedMeteredIceExpiry
      ) {
        const url =
          `https://${process.env.METERED_DOMAIN}` +
          `/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`;

        const meteredRes = await fetch(url);

        if (meteredRes.ok) {
          const meteredData = await meteredRes.json();

          cachedMeteredIce = Array.isArray(meteredData)
            ? meteredData
            : meteredData.iceServers;

          cachedMeteredIceExpiry =
            Date.now() + METERED_CACHE_MS;
        } else {
          console.warn(
            `Metered TURN credential fetch failed: HTTP ${meteredRes.status}`
          );
        }
      }

      if (cachedMeteredIce) {
        return res.json({
          iceServers: cachedMeteredIce,
        });
      }
    } catch (err) {
      console.warn(
        'Metered TURN credential fetch failed, falling back:',
        err.message
      );
    }
  }

  if (process.env.TURN_URL) {
    const urls = process.env.TURN_URL
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);

    iceServers.push({
      urls: urls.length > 1 ? urls : urls[0],
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  } else if (!process.env.METERED_DOMAIN) {
    console.warn(
      'No TURN server configured - calls between peers behind restrictive ' +
      'NATs/firewalls may fail to connect. See README "TURN server" section.'
    );
  }

  res.json({
    iceServers,
  });
});

// ---------- Socket.io: auth middleware ----------

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error('AUTH_REQUIRED'));
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    socket.user = {
      id: payload.sub,
      username: payload.username,
    };

    next();
  } catch {
    next(new Error('INVALID_TOKEN'));
  }
});

// ---------- Rooms ----------

// roomId -> Set of socket ids
const rooms = new Map();

// roomId -> socket id of the room creator
//
// The first person who creates/joins an empty room becomes its owner.
// Only this socket is allowed to kick other users.
const roomOwners = new Map();

// roomId -> array of whiteboard strokes
const roomWhiteboards = new Map();

const MAX_STROKES_PER_ROOM = 4000;

// ---------- Socket.io connection ----------

io.on('connection', (socket) => {
  let currentRoom = null;

  // ---- Join room ----

  socket.on('join-room', ({ roomId }) => {
    if (!roomId) return;

    currentRoom = roomId;

    // Create room if it doesn't exist.
    //
    // The first person entering the room becomes the owner.
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());

      // THIS USER IS THE ROOM CREATOR / OWNER
      roomOwners.set(roomId, socket.id);
    }

    const roomPeers = rooms.get(roomId);
    const ownerSocketId = roomOwners.get(roomId);

    // Tell the new user who is already in the room.
    const existingPeers = Array.from(roomPeers).map((id) => ({
      socketId: id,
      username: io.sockets.sockets.get(id)?.user?.username,
    }));

    socket.emit('existing-peers', existingPeers);

    // Tell client who owns the room.
    socket.emit('room-info', {
      ownerSocketId,
    });

    // Replay whiteboard state for late joiners.
    socket.emit('whiteboard-state', {
      strokes: roomWhiteboards.get(roomId) || [],
    });

    roomPeers.add(socket.id);

    socket.join(roomId);

    // Tell everyone else that a new peer joined.
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      username: socket.user.username,
    });
  });

  // ---- Kick user ----
  //
  // ONLY THE ROOM CREATOR CAN USE THIS.
  //
  // The frontend will hide the Kick button from joiners,
  // but this server-side check is the actual security protection.

  socket.on('kick-user', ({ roomId, targetSocketId }) => {
    if (!roomId || !targetSocketId) {
      return;
    }

    // Get the creator of this room.
    const ownerSocketId = roomOwners.get(roomId);

    // SECURITY CHECK:
    // Only the creator can kick someone.
    if (socket.id !== ownerSocketId) {
      return socket.emit('kick-error', {
        error: 'Only the room creator can kick users.',
      });
    }

    // Creator cannot kick himself.
    if (targetSocketId === ownerSocketId) {
      return socket.emit('kick-error', {
        error: 'The room creator cannot kick himself.',
      });
    }

    const roomPeers = rooms.get(roomId);

    if (!roomPeers || !roomPeers.has(targetSocketId)) {
      return socket.emit('kick-error', {
        error: 'User is not in this room.',
      });
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (!targetSocket) {
      return socket.emit('kick-error', {
        error: 'User connection not found.',
      });
    }

    // Tell the target user they were kicked.
    targetSocket.emit('kicked', {
      roomId,
      reason: 'You were removed by the room creator.',
    });

    // Remove/disconnect the target.
    //
    // The existing disconnect handler below will automatically
    // clean them from the room and notify everyone.
    targetSocket.disconnect(true);
  });

  // ---- WebRTC signaling relay ----

  socket.on('signal', ({ to, data }) => {
    if (!to) return;

    io.to(to).emit('signal', {
      from: socket.id,
      username: socket.user.username,
      data,
    });
  });

  // ---- Screen share notification ----

  socket.on('screen-share-status', ({ roomId, sharing }) => {
    socket.to(roomId).emit('screen-share-status', {
      socketId: socket.id,
      sharing,
    });
  });

  // ---- Whiteboard sync ----

  socket.on('whiteboard-draw', ({ roomId, stroke }) => {
    if (!roomId || !stroke) return;

    if (!roomWhiteboards.has(roomId)) {
      roomWhiteboards.set(roomId, []);
    }

    const strokes = roomWhiteboards.get(roomId);

    strokes.push(stroke);

    if (strokes.length > MAX_STROKES_PER_ROOM) {
      strokes.shift();
    }

    socket.to(roomId).emit('whiteboard-draw', stroke);
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    if (!roomId) return;

    roomWhiteboards.set(roomId, []);

    socket.to(roomId).emit('whiteboard-clear');
  });

  // ---- File share broadcast ----

  socket.on('file-shared', ({ roomId, file }) => {
    socket.to(roomId).emit('file-shared', {
      ...file,
      sharedBy: socket.user.username,
    });
  });

  // ---- Chat ----

  socket.on('chat-message', ({ roomId, message }) => {
    io.to(roomId).emit('chat-message', {
      username: socket.user.username,
      message,
      at: new Date().toISOString(),
    });
  });

  // ---- Leave room ----

  socket.on('leave-room', () => {
    cleanupRoom();
  });

  // ---- Disconnect ----

  socket.on('disconnect', () => {
    cleanupRoom();
  });

  // ---------- Room cleanup ----------

  function cleanupRoom() {
    if (!currentRoom) return;

    const roomId = currentRoom;
    const roomPeers = rooms.get(roomId);

    if (roomPeers) {
      roomPeers.delete(socket.id);

      // If room is empty, completely remove room data.
      if (roomPeers.size === 0) {
        rooms.delete(roomId);

        // Remove room owner as well.
        roomOwners.delete(roomId);

        // Remove whiteboard state.
        roomWhiteboards.delete(roomId);
      }
    }

    // Tell remaining users that this user left.
    socket.to(roomId).emit('user-left', {
      socketId: socket.id,
    });

    socket.leave(roomId);

    currentRoom = null;
  }
});

// ---------- Start server ----------

server.listen(PORT, () => {
  const scheme = hasCerts ? 'https' : 'http';

  console.log(
    `Server running: ${scheme}://localhost:${PORT}`
  );
});
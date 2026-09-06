// auth.js
// Handles registration, login, and token verification.
// Passwords are hashed with bcrypt (never stored in plain text).
// Sessions are handled via signed JWTs (stateless auth).

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { findUserByUsername, createUser } = require('./db');

const router = express.Router();
const TOKEN_EXPIRY = '12h';

// In production, tokens signed with a hardcoded/guessable secret can be forged
// by anyone who reads the source - so refuse to start rather than run insecurely.
// Locally (no NODE_ENV=production) the dev fallback is fine.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is required when NODE_ENV=production. ' +
    'Set it to a long random string (e.g. `openssl rand -hex 32`) before starting the server.'
  );
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-in-production';

function isValidUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 chars (letters, numbers, underscore).' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (findUserByUsername(username)) {
    return res.status(409).json({ error: 'Username already taken.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, passwordHash, createdAt: new Date().toISOString() };

  try {
    createUser(user);
  } catch (err) {
    // Two requests for the same username can both pass the check above and
    // race to insert - the DB's unique index is the real guard, so a
    // collision here is a normal 409, not a server error.
    if (err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message)) {
      return res.status(409).json({ error: 'Username already taken.' });
    }
    throw err;
  }

  const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  res.status(201).json({ token, username: user.username });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = findUserByUsername(username || '');

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const match = await bcrypt.compare(password || '', user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  res.json({ token, username: user.username });
});

router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, username: payload.username });
  } catch {
    res.status(401).json({ valid: false, error: 'Invalid or expired token.' });
  }
});

module.exports = { router, JWT_SECRET };

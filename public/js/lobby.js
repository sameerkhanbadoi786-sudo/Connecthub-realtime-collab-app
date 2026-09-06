// lobby.js (frontend)
// The screen between login and the call: pick "Create a Room" or "Join a Room".

const token = localStorage.getItem('token');
const username = localStorage.getItem('username');

if (!token || !username) {
  window.location.href = '/index.html';
}

document.getElementById('username-display').textContent = username;
document.getElementById('avatar-initial').textContent = username.charAt(0).toUpperCase();

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  window.location.href = '/index.html';
});

// ---------- Mobile hamburger menu ----------
// On narrow screens the header collapses to just the brand + this button;
// tapping it reveals the account info and log out control as a dropdown.
const menuBtn = document.getElementById('lobby-menu-btn');
const userMenu = document.getElementById('lobby-user-menu');

function closeUserMenu() {
  userMenu.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = userMenu.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', (e) => {
  if (!userMenu.contains(e.target) && e.target !== menuBtn) closeUserMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeUserMenu();
});

// ---------- Create room ----------
document.getElementById('create-room-btn').addEventListener('click', () => {
  const roomId = Math.random().toString(36).substring(2, 8);
  window.location.href = `/room.html?room=${encodeURIComponent(roomId)}`;
});

// ---------- Join room ----------
const joinInput = document.getElementById('join-room-input');
const joinBtn = document.getElementById('join-room-btn');
const errorEl = document.getElementById('lobby-error');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.className = 'status-msg error';
}

function joinRoom() {
  const roomId = joinInput.value.trim();
  if (!roomId) {
    showError('Enter a room code to join.');
    return;
  }
  window.location.href = `/room.html?room=${encodeURIComponent(roomId)}`;
}

joinBtn.addEventListener('click', joinRoom);
joinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

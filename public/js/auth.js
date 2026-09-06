// auth.js (frontend)
// Handles the login/register forms. On success, sends the user to the lobby
// (lobby.html) where they choose to create or join a room.

// Already signed in? Skip straight past the login screen.
if (localStorage.getItem('token') && localStorage.getItem('username')) {
  window.location.href = '/lobby.html';
}

const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const errorEl = document.getElementById('auth-error');

tabLogin.addEventListener('click', () => switchTab('login'));
tabRegister.addEventListener('click', () => switchTab('register'));

function switchTab(which) {
  const isLogin = which === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabRegister.classList.toggle('active', !isLogin);
  loginForm.classList.toggle('hidden', !isLogin);
  registerForm.classList.toggle('hidden', isLogin);
  hideError();
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.className = 'status-msg error';
}
function hideError() {
  errorEl.className = 'status-msg hidden';
}

async function submitAuth(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const { token, username: uname } = await submitAuth('/api/auth/login', { username, password });
    localStorage.setItem('token', token);
    localStorage.setItem('username', uname);
    window.location.href = '/lobby.html';
  } catch (err) {
    showError(err.message);
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  try {
    const { token, username: uname } = await submitAuth('/api/auth/register', { username, password });
    localStorage.setItem('token', token);
    localStorage.setItem('username', uname);
    window.location.href = '/lobby.html';
  } catch (err) {
    showError(err.message);
  }
});

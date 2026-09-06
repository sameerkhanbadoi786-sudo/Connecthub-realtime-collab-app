// whiteboard.js (frontend)
// A simple shared canvas: strokes are captured as point sequences and
// broadcast over the same authenticated Socket.io connection used for
// signaling/chat/files, then replayed on every other client in the room.
// This file expects `socket` and `roomId` to already exist (defined in room.js,
// loaded before this script).

const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('wb-color');
const sizePicker = document.getElementById('wb-size');
const clearBtn = document.getElementById('wb-clear');

ctx.lineCap = 'round';
ctx.lineJoin = 'round';

let drawing = false;
let currentStroke = null;

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function startStroke(e) {
  drawing = true;
  const { x, y } = getPos(e);
  currentStroke = {
    color: colorPicker.value,
    size: Number(sizePicker.value),
    points: [{ x, y }],
  };
}

function extendStroke(e) {
  if (!drawing) return;
  const { x, y } = getPos(e);
  currentStroke.points.push({ x, y });
  drawStroke(currentStroke, true);
}

function endStroke() {
  if (!drawing) return;
  drawing = false;
  if (currentStroke && currentStroke.points.length > 1) {
    socket.emit('whiteboard-draw', { roomId, stroke: currentStroke });
  }
  currentStroke = null;
}

function drawStroke(stroke, onlyLastSegment = false) {
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.beginPath();

  const pts = stroke.points;
  if (onlyLastSegment && pts.length >= 2) {
    const p1 = pts[pts.length - 2];
    const p2 = pts[pts.length - 1];
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  } else {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
}

canvas.addEventListener('mousedown', startStroke);
canvas.addEventListener('mousemove', extendStroke);
window.addEventListener('mouseup', endStroke);

canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startStroke(e); }, { passive: false });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); extendStroke(e); }, { passive: false });
canvas.addEventListener('touchend', endStroke);

clearBtn.addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit('whiteboard-clear', { roomId });
});

// ---------- Receive remote strokes ----------
socket.on('whiteboard-draw', (stroke) => {
  drawStroke(stroke, false);
});

socket.on('whiteboard-clear', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// Sent once, right after joining: everything drawn on the board before we
// arrived, so latecomers see the full whiteboard instead of a blank one.
socket.on('whiteboard-state', ({ strokes }) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  (strokes || []).forEach((stroke) => drawStroke(stroke, false));
});

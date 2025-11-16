const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    // Allow all origins during development so other devices on your LAN can connect
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingInterval: 25000,
  pingTimeout: 20000,
});

const HEARTBEAT_TIMEOUT_MS = 30000; // remove zombie users after 30s of no heartbeat

app.use(cors());
app.use(express.json());

// Store users and messages in memory (for demo purposes)
const users = new Map();
const conversations = new Map(); // Store conversations between users
const accounts = new Map(); // Simple in-memory accounts { username -> { username, password } }

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (userData) => {
    // Validate that username is provided
    if (!userData.username || userData.username.trim() === '') {
      socket.emit('joinError', { message: 'Username is required' });
      return;
    }

    // Allow same username across multiple devices/sessions
    const user = { id: socket.id, username: userData.username, lastSeen: Date.now() };
    users.set(socket.id, user);
    
    // Send user list to all clients
    io.emit('users', Array.from(users.values()));
    
    socket.broadcast.emit('userJoined', user);
    socket.emit('joinSuccess', { message: 'Successfully joined chat' });
  });

  // Client-initiated logout to remove entry immediately on tab close
  socket.on('logout', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      io.emit('users', Array.from(users.values()));
      socket.broadcast.emit('userLeft', user);
    }
    try { socket.disconnect(true); } catch (e) {}
  });

  // Heartbeat from clients to keep connection fresh
  socket.on('heartbeat', () => {
    const user = users.get(socket.id);
    if (user) {
      user.lastSeen = Date.now();
      users.set(socket.id, user);
    }
  });

  socket.on('sendMessage', (messageData) => {
    const sender = users.get(socket.id);
    if (!sender) return;

    const recipient = users.get(messageData.recipientId);
    if (!recipient) return;

    const message = {
      id: uuidv4(),
      senderId: socket.id,
      senderName: sender.username,
      recipientId: messageData.recipientId,
      text: messageData.text,
      timestamp: new Date().toISOString()
    };
    
    // Create conversation key by stable usernames (sorted to ensure consistency)
    const conversationKey = [sender.username, recipient.username].sort().join('-');
    
    // Store message in conversation
    if (!conversations.has(conversationKey)) {
      conversations.set(conversationKey, []);
    }
    conversations.get(conversationKey).push(message);
    
    // Send message to recipient
    io.to(messageData.recipientId).emit('newMessage', { ...message, type: 'received' });
    
    // Send confirmation to sender
    socket.emit('messageSent', { ...message, type: 'sent' });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      io.emit('users', Array.from(users.values()));
      socket.broadcast.emit('userLeft', user);
    }
    console.log('User disconnected:', socket.id);
  });
});

// Periodic cleanup of stale users
setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const [socketId, user] of users.entries()) {
    const staleSocket = io.sockets.sockets.get(socketId);
    const isStale = !user.lastSeen || (now - user.lastSeen > HEARTBEAT_TIMEOUT_MS) || !staleSocket;
    if (isStale) {
      users.delete(socketId);
      changed = true;
      if (staleSocket) {
        try { staleSocket.disconnect(true); } catch (e) {}
      }
    }
  }
  if (changed) {
    io.emit('users', Array.from(users.values()));
  }
}, 10000);

// REST API endpoints
app.get('/api/users', (req, res) => {
  res.json(Array.from(users.values()));
});

// Signup: create account if username not exists
app.post('/api/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || !username.trim() || !password.trim()) {
    return res.status(400).json({ message: 'Username and password are required' });
  }
  if (accounts.has(username)) {
    return res.status(409).json({ message: 'Username already exists' });
  }
  accounts.set(username, { username, password });
  return res.status(201).json({ message: 'Account created successfully' });
});

// Login: validate credentials
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || !username.trim() || !password.trim()) {
    return res.status(400).json({ message: 'Username and password are required' });
  }
  const account = accounts.get(username);
  if (!account || account.password !== password) {
    return res.status(401).json({ message: 'Invalid username or password' });
  }
  return res.json({ message: 'Login successful' });
});

// Conversations by usernames (persistent across reconnections)
app.get('/api/conversations/:username1/:username2', (req, res) => {
  const { username1, username2 } = req.params;
  const conversationKey = [username1, username2].sort().join('-');
  const conversation = conversations.get(conversationKey) || [];
  res.json(conversation);
});

// Serve frontend build (single-domain deployment)
const buildPath = path.join(__dirname, '../frontend/build');
app.use(express.static(buildPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
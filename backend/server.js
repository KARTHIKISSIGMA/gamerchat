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
  }
});

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

    // Check if this username is already online
    const existingUsers = Array.from(users.values());
    const usernameTakenOnline = existingUsers.some(user => user.username === userData.username);
    
    if (usernameTakenOnline) {
      socket.emit('joinError', { message: 'Username is already taken' });
      return;
    }

    const user = { id: socket.id, username: userData.username };
    users.set(socket.id, user);
    
    // Send user list to all clients
    io.emit('users', Array.from(users.values()));
    
    socket.broadcast.emit('userJoined', user);
    socket.emit('joinSuccess', { message: 'Successfully joined chat' });
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
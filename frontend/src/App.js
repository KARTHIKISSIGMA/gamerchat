import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

// Use same-origin in production (served by backend), or allow override via env
const API_URL = process.env.REACT_APP_API_URL || window.location.origin;

function App() {
  const [socket, setSocket] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef(null);
  const [authMode, setAuthMode] = useState('login');

  useEffect(() => {
    if (isLoggedIn) {
      const newSocket = io(API_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        newSocket.emit('join', { username });
      });

      newSocket.on('joinSuccess', () => {
        // Login is already handled by isLoggedIn state
      });

      newSocket.on('joinError', (error) => {
        setLoginError(error.message);
        setIsLoggedIn(false);
        setSocket(null);
      });

      newSocket.on('users', (usersList) => {
        setUsers(usersList.filter(user => user.id !== newSocket.id));
      });

      newSocket.on('userJoined', (user) => {
        if (user.id !== newSocket.id) {
          setUsers(prev => [...prev, user]);
        }
      });

      newSocket.on('userLeft', (user) => {
        setUsers(prev => prev.filter(u => u.id !== user.id));
      });

      newSocket.on('newMessage', (message) => {
        setMessages(prev => [...prev, { ...message, type: 'received' }]);
      });

      newSocket.on('messageSent', (message) => {
        setMessages(prev => [...prev, { ...message, type: 'sent' }]);
      });

      return () => {
        newSocket.close();
      };
    }
  }, [isLoggedIn, username, password]); // eslint-disable-next-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      if (!username.trim() || !password.trim()) {
        setLoginError('Username and password are required');
        return;
      }
      if (authMode === 'signup') {
        await axios.post(`${API_URL}/api/signup`, { username, password });
        setIsLoggedIn(true);
      } else {
        await axios.post(`${API_URL}/api/login`, { username, password });
        setIsLoggedIn(true);
      }
    } catch (err) {
      const message = err.response?.data?.message || 'Something went wrong';
      setLoginError(message);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (messageInput.trim() && selectedUser && socket) {
      socket.emit('sendMessage', {
        text: messageInput,
        recipientId: selectedUser.id
      });
      setMessageInput('');
    }
  };

  const loadConversationHistory = async (username1, username2) => {
    try {
      const response = await axios.get(`${API_URL}/api/conversations/${username1}/${username2}`);
      const conversation = response.data.map(msg => ({
        ...msg,
        type: msg.senderId === socket.id ? 'sent' : 'received'
      }));
      setMessages(conversation);
    } catch (error) {
      console.error('Error loading conversation history:', error);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="auth-banner">Gamerchat.io</div>
        <form className="login-form" onSubmit={handleLogin}>
          <div className="auth-toggle" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Log In</button>
            <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
          </div>
          <h2>{authMode === 'signup' ? 'Sign Up' : 'Log In'} to Chat</h2>
          {loginError && <div className="error-message">{loginError}</div>}
          <input
            type="text"
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit">{authMode === 'signup' ? 'Create Account' : 'Log In'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="chat-app">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Online Users</h2>
        </div>
        <div className="user-info">
          <p>Logged in as: <strong>{username}</strong></p>
        </div>
        <div className="users-list">
          {users.map((user) => (
            <div
              key={user.id}
              className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedUser(user);
                if (socket) {
                  loadConversationHistory(username, user.username);
                }
              }}
            >
              <h4>{user.username}</h4>
              <p>Click to chat</p>
            </div>
          ))}
          {users.length === 0 && (
            <div className="user-item">
              <p>No other users online</p>
            </div>
          )}
        </div>
      </div>

      <div className="chat-area">
        {selectedUser ? (
          <>
            <div className="chat-header">
              <h3>Chat with {selectedUser.username}</h3>
            </div>
            <div className="messages-container">
              {messages.map((message) => (
                <div key={message.id} className={`message ${message.type}`}>
                  <div className="message-header">
                    {message.username} - {new Date(message.timestamp).toLocaleTimeString()}
                  </div>
                  <div>{message.text}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form className="message-input" onSubmit={handleSendMessage}>
              <input
                type="text"
                placeholder="Type a message..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                required
              />
              <button type="submit">Send</button>
            </form>
          </>
        ) : (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100%',
            color: '#666'
          }}>
            <h3>Select a user to start chatting</h3>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
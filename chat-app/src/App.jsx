import { useState, useEffect, useRef } from 'react';
import { Send, Lock, Users, Clock, Copy, Check, Moon, Sun, LogOut, History, Smile, Timer, AlertCircle } from 'lucide-react';
import { generateSharedKey, encryptMessage, decryptMessage, exportKey, importKey, validateKey, getKeyFingerprint } from './utils/crypto';
import Auth from './components/Auth';
import TypingIndicator from './components/TypingIndicator';
import InstallPrompt from './components/InstallPrompt';
import InstallButton from './components/InstallButton';
import './App.css';

// ✅ Environment-based API URLs for deployment
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

console.log('🌍 Environment:', import.meta.env.MODE);
console.log('🔗 API URL:', API_URL);
console.log('🔌 WebSocket URL:', WS_URL);

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [ws, setWs] = useState(null);
  const [sharedKey, setSharedKey] = useState(null);
  const [roomInfo, setRoomInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [shareableLink, setShareableLink] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [messageReactions, setMessageReactions] = useState({});
  const [selfDestructMode, setSelfDestructMode] = useState(false);
  const [keyFingerprint, setKeyFingerprint] = useState('');
  const [connectionError, setConnectionError] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const wsRef = useRef(null);
  
  const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes
  const TYPING_TIMEOUT = 3000; // 3 seconds

  // Common emojis for quick reactions
  const quickEmojis = ['😊', '😂', '❤️', '👍', '👎', '🔥', '✨', '🎉'];
  const reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  // Load room and key from URL hash
  useEffect(() => {
    const loadKeyFromURL = async () => {
      const hash = window.location.hash.substring(1);
      
      if (hash) {
        const params = new URLSearchParams(hash);
        const room = params.get('room');
        const encodedKey = params.get('key');
        
        if (room && encodedKey) {
          console.log('📥 Loading room from URL:', room);
          setRoomId(room);
          
          try {
            // CRITICAL FIX: Decode URL-encoded key
            const decodedKey = decodeURIComponent(encodedKey);
            
            console.log('🔍 Encoded key length:', encodedKey.length);
            console.log('🔍 Decoded key length:', decodedKey.length);
            console.log('🔍 Key preview:', decodedKey.substring(0, 20) + '...');
            
            const importedKey = await importKey(decodedKey);
            const validation = validateKey(importedKey);
            
            if (!validation.valid) {
              throw new Error(validation.error);
            }
            
            setSharedKey(importedKey);
            
            // Generate and store fingerprint
            const fingerprint = await getKeyFingerprint(importedKey);
            setKeyFingerprint(fingerprint);
            
            // Store the ORIGINAL decoded key in sessionStorage
            sessionStorage.setItem('chatKey', decodedKey);
            sessionStorage.setItem('chatRoom', room);
            sessionStorage.setItem('keyFingerprint', fingerprint);
            
            console.log('✅ Key imported successfully. Fingerprint:', fingerprint);
          } catch (error) {
            console.error('❌ Failed to import key:', error);
            alert('Invalid encryption key. The share link may be corrupted.\n\nPlease create a new room.');
            window.location.hash = '';
            sessionStorage.clear();
          }
        }
      } else {
        // Try to recover from sessionStorage if page was refreshed
        const storedKey = sessionStorage.getItem('chatKey');
        const storedRoom = sessionStorage.getItem('chatRoom');
        const storedFingerprint = sessionStorage.getItem('keyFingerprint');
        
        if (storedKey && storedRoom) {
          console.log('🔄 Restoring session from storage');
          setRoomId(storedRoom);
          setKeyFingerprint(storedFingerprint || '');
          
          try {
            const importedKey = await importKey(storedKey);
            setSharedKey(importedKey);
            
            // Regenerate shareable link
            const encodedKey = encodeURIComponent(storedKey);
            const link = `${window.location.origin}/#room=${storedRoom}&key=${encodedKey}`;
            setShareableLink(link);
            
            console.log('✅ Session restored successfully');
          } catch (error) {
            console.error('❌ Failed to restore key:', error);
            sessionStorage.removeItem('chatKey');
            sessionStorage.removeItem('chatRoom');
            sessionStorage.removeItem('keyFingerprint');
          }
        }
      }
    };
    
    loadKeyFromURL();
  }, []);

  // Session management with auto-logout
  useEffect(() => {
    if (user) {
      resetSessionTimeout();
      
      const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
      events.forEach(event => {
        document.addEventListener(event, resetSessionTimeout);
      });
      
      return () => {
        events.forEach(event => {
          document.removeEventListener(event, resetSessionTimeout);
        });
        if (sessionTimeout) clearTimeout(sessionTimeout);
      };
    }
  }, [user]);

  const resetSessionTimeout = () => {
    if (sessionTimeout) clearTimeout(sessionTimeout);
    
    const timeout = setTimeout(() => {
      handleLogout();
      alert('Session expired due to inactivity');
    }, SESSION_DURATION);
    
    setSessionTimeout(timeout);
  };

  // Auto-delete self-destruct messages
  useEffect(() => {
    messages.forEach((msg, index) => {
      if (msg.selfDestruct && msg.timestamp && !msg.deleted) {
        const deleteTime = new Date(msg.timestamp).getTime() + (msg.destructTime || 60000);
        const now = Date.now();
        
        if (deleteTime > now) {
          setTimeout(() => {
            setMessages(prev => prev.map((m, i) => 
              i === index ? { ...m, text: '[Message deleted]', deleted: true } : m
            ));
          }, deleteTime - now);
        }
      }
    });
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  const copyShareableLink = () => {
    navigator.clipboard.writeText(shareableLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogout = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'user_leaving',
        username: user.displayName
      }));
      ws.close();
    }
    
    setUser(null);
    setJoined(false);
    setMessages([]);
    setRoomId('');
    setShareableLink('');
    setSharedKey(null);
    setKeyFingerprint('');
    setConnectionError(false);
    window.location.hash = '';
    sessionStorage.removeItem('chatKey');
    sessionStorage.removeItem('chatRoom');
    sessionStorage.removeItem('keyFingerprint');
    
    if (sessionTimeout) clearTimeout(sessionTimeout);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  const loadMessageHistory = async (roomId, key) => {
    if (!key) {
      console.error('❌ No encryption key available for decryption');
      return;
    }

    // Validate key before attempting decryption
    const validation = validateKey(key);
    if (!validation.valid) {
      console.error('❌ Invalid key:', validation.error);
      return;
    }

    setLoadingHistory(true);
    let decryptionErrors = 0;
    
    try {
      // ✅ Use environment variable for API URL
      const response = await fetch(`${API_URL}/room/${roomId}/history`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch history');
      }
      
      const data = await response.json();
      
      if (data.messages && data.messages.length > 0) {
        console.log(`📜 Loading ${data.messages.length} messages from history`);
        
        const decryptedMessages = await Promise.all(
          data.messages.map(async (msg, index) => {
            try {
              // Validate encrypted data structure
              if (!msg.encrypted_data || 
                  !msg.encrypted_data.encrypted || 
                  !msg.encrypted_data.iv) {
                console.error('❌ Invalid message format at index', index);
                return null;
              }

              const decrypted = await decryptMessage(
                msg.encrypted_data.encrypted,
                msg.encrypted_data.iv,
                key
              );
              
              return {
                text: decrypted,
                username: msg.username,
                timestamp: msg.timestamp,
                type: 'message',
                isMine: msg.username === user?.displayName,
                selfDestruct: msg.selfDestruct || false,
                destructTime: msg.destructTime || null
              };
            } catch (error) {
              decryptionErrors++;
              console.error(`❌ Failed to decrypt message ${index}:`, error.message);
              
              // Return encrypted message indicator
              return {
                text: '🔒 [Unable to decrypt - wrong encryption key]',
                username: msg.username,
                timestamp: msg.timestamp,
                type: 'message',
                isMine: false,
                encrypted: true
              };
            }
          })
        );
        
        const validMessages = decryptedMessages.filter(msg => msg !== null);
        
        if (decryptionErrors > 0) {
          console.warn(`⚠️ ${decryptionErrors} message(s) could not be decrypted`);
          setMessages(prev => [...prev, {
            text: `⚠️ Warning: ${decryptionErrors} message(s) could not be decrypted. You may be using a different encryption key.`,
            type: 'system'
          }]);
        }
        
        if (validMessages.length > 0) {
          setMessages(validMessages);
          console.log(`✅ Loaded ${validMessages.length - decryptionErrors} messages successfully`);
        }
      } else {
        console.log('📭 No message history found');
      }
    } catch (error) {
      console.error('❌ Failed to load message history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleTyping = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    if (!isTyping) {
      setIsTyping(true);
      ws.send(JSON.stringify({
        type: 'typing',
        username: user.displayName,
        isTyping: true
      }));
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'typing',
          username: user.displayName,
          isTyping: false
        }));
      }
    }, TYPING_TIMEOUT);
  };

  const joinRoom = async () => {
    let key = sharedKey;
    let currentRoomId = roomId.trim();

    // CRITICAL: Prevent joining existing rooms without a key
    if (currentRoomId && !key) {
      alert('⚠️ Cannot join existing room without encryption key.\n\nYou must use the shared link to join this room.');
      setRoomId('');
      return;
    }

    // Case 1: Creating new room (no key, with or without room ID)
    if (!key) {
      if (!currentRoomId) {
        currentRoomId = generateRoomId();
        setRoomId(currentRoomId);
      }
      
      console.log('🔑 Generating new encryption key for room:', currentRoomId);
      
      // Generate new key for the room
      key = await generateSharedKey();
      setSharedKey(key);

      const exportedKey = await exportKey(key);
      console.log('📤 Original key length:', exportedKey.length);
      console.log('📤 Original key preview:', exportedKey.substring(0, 30) + '...');
      
      // CRITICAL FIX: URL-encode the key to prevent corruption
      const encodedKey = encodeURIComponent(exportedKey);
      console.log('🔐 Encoded key length:', encodedKey.length);
      
      const fingerprint = await getKeyFingerprint(key);
      setKeyFingerprint(fingerprint);
      
      const link = `${window.location.origin}/#room=${currentRoomId}&key=${encodedKey}`;
      setShareableLink(link);
      
      // Store the ORIGINAL (non-encoded) key in sessionStorage
      sessionStorage.setItem('chatKey', exportedKey);
      sessionStorage.setItem('chatRoom', currentRoomId);
      sessionStorage.setItem('keyFingerprint', fingerprint);
      
      // Update URL hash with encoded key
      window.location.hash = `room=${currentRoomId}&key=${encodedKey}`;
      
      console.log('✅ New room created with fingerprint:', fingerprint);
    }
    // Case 2: User has key from URL (joining existing room)
    else if (key && currentRoomId) {
      console.log('🔓 Joining existing room:', currentRoomId);
      
      const exportedKey = await exportKey(key);
      const encodedKey = encodeURIComponent(exportedKey);
      
      const link = `${window.location.origin}/#room=${currentRoomId}&key=${encodedKey}`;
      setShareableLink(link);
      
      // Store in sessionStorage for persistence (non-encoded)
      sessionStorage.setItem('chatKey', exportedKey);
      sessionStorage.setItem('chatRoom', currentRoomId);
      
      if (!keyFingerprint) {
        const fingerprint = await getKeyFingerprint(key);
        setKeyFingerprint(fingerprint);
        sessionStorage.setItem('keyFingerprint', fingerprint);
      }
      
      console.log('✅ Using existing key with fingerprint:', keyFingerprint);
    }

    // Validate key before connecting
    const validation = validateKey(key);
    if (!validation.valid) {
      alert(`Invalid encryption key: ${validation.error}`);
      return;
    }

    // ✅ Use environment variable for WebSocket URL
    console.log('🔌 Connecting to WebSocket:', currentRoomId);
    const websocket = new WebSocket(`${WS_URL}/ws/${currentRoomId}`);
    wsRef.current = websocket;
    
    websocket.onopen = async () => {
      console.log('✅ WebSocket connected');
      setConnectionError(false);
      setJoined(true);
      
      await fetchRoomInfo(currentRoomId);
      await loadMessageHistory(currentRoomId, key);
      
      websocket.send(JSON.stringify({
        type: 'join',
        username: user.displayName
      }));
    };

    websocket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'message') {
        try {
          // Verify key exists and is valid
          if (!key) {
            throw new Error('No encryption key available');
          }

          const decrypted = await decryptMessage(
            data.data.encrypted,
            data.data.iv,
            key
          );
          
          setMessages(prev => [...prev, {
            text: decrypted,
            username: data.username,
            timestamp: data.timestamp,
            type: 'message',
            isMine: data.username === user.displayName,
            selfDestruct: data.selfDestruct || false,
            destructTime: data.destructTime || null
          }]);
        } catch (error) {
          console.error('❌ Decryption failed:', error.name, error.message);
          console.error('💡 This usually means the sender used a different encryption key');
          
          setMessages(prev => [...prev, {
            text: '🔒 [Message encrypted with different key]',
            username: data.username,
            timestamp: data.timestamp,
            type: 'message',
            isMine: false,
            encrypted: true
          }]);
        }
      } else if (data.type === 'typing') {
        if (data.username !== user.displayName) {
          setTypingUsers(prev => {
            const newSet = new Set(prev);
            if (data.isTyping) {
              newSet.add(data.username);
            } else {
              newSet.delete(data.username);
            }
            return newSet;
          });
        }
      } else if (data.type === 'reaction') {
        setMessageReactions(prev => ({
          ...prev,
          [data.messageIndex]: {
            ...(prev[data.messageIndex] || {}),
            [data.emoji]: ((prev[data.messageIndex]?.[data.emoji]) || 0) + 1
          }
        }));
      } else if (data.type === 'user_joined') {
        setMessages(prev => [...prev, { 
          text: data.message, 
          type: 'system' 
        }]);
      } else if (data.type === 'user_left') {
        setMessages(prev => [...prev, { 
          text: data.message, 
          type: 'system' 
        }]);
      } else if (data.type === 'room_expired') {
        setMessages(prev => [...prev, { 
          text: data.message, 
          type: 'system' 
        }]);
        websocket.close();
      }
    };

    websocket.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      setConnectionError(true);
      setMessages(prev => [...prev, {
        text: '❌ Connection error. Please check your network and try again.',
        type: 'system'
      }]);
    };

    websocket.onclose = (event) => {
      console.log('🔌 WebSocket disconnected:', event.code, event.reason);
      setJoined(false);
      
      if (event.code !== 1000 && event.code !== 1001) {
        setConnectionError(true);
      }
    };

    setWs(websocket);
  };

  const fetchRoomInfo = async (room) => {
    try {
      // ✅ Use environment variable for API URL
      const response = await fetch(`${API_URL}/room/${room}/info`);
      const data = await response.json();
      setRoomInfo(data);
      
      if (!data.exists) {
        setMessages(prev => [...prev, {
          text: '⚠️ Room does not exist or has expired',
          type: 'system'
        }]);
      } else {
        console.log('✅ Room info loaded:', data);
      }
    } catch (error) {
      console.error('❌ Failed to fetch room info:', error);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !ws || !sharedKey) return;

    // Validate WebSocket connection
    if (ws.readyState !== WebSocket.OPEN) {
      alert('Not connected to chat room. Please try rejoining.');
      return;
    }

    // Validate key
    const validation = validateKey(sharedKey);
    if (!validation.valid) {
      alert(`Cannot send message: ${validation.error}`);
      return;
    }

    try {
      const encrypted = await encryptMessage(inputMessage, sharedKey);
      
      ws.send(JSON.stringify({
        type: 'message',
        data: encrypted,
        username: user.displayName,
        selfDestruct: selfDestructMode,
        destructTime: selfDestructMode ? 60000 : null
      }));
      
      setInputMessage('');
      setIsTyping(false);
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      alert('Failed to send message. Please try again.');
    }
  };

  const addReaction = (messageIndex, emoji) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({
      type: 'reaction',
      messageIndex,
      emoji,
      username: user.displayName
    }));
  };

  const insertEmoji = (emoji) => {
    setInputMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e) => {
    setInputMessage(e.target.value);
    handleTyping();
  };

  if (!user) {
    return (
      <div className="app">
        <InstallPrompt />
        <button 
          className="theme-toggle floating"
          onClick={() => setDarkMode(!darkMode)}
          aria-label="Toggle theme"
        >
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <Auth onLogin={setUser} />
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="app">
        <InstallPrompt />
        <button 
          className="theme-toggle floating"
          onClick={() => setDarkMode(!darkMode)}
          aria-label="Toggle theme"
        >
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <button 
          className="logout-btn floating"
          onClick={handleLogout}
          aria-label="Logout"
        >
          <LogOut size={20} />
        </button>
        <div className="join-container">
          <div className="join-card">
            <div className="lock-icon">
              <Lock size={48} />
            </div>
            <h1>Welcome, {user.displayName}!</h1>
            <p className="subtitle">
              {sharedKey 
                ? `Join encrypted room: ${roomId}` 
                : 'Create an encrypted chat room'}
            </p>
            
            <div className="features">
              <div className="feature">
                <Lock size={20} />
                <span>E2E Encrypted</span>
              </div>
              <div className="feature">
                <Clock size={20} />
                <span>Auto-delete in 3h</span>
              </div>
              <div className="feature">
                <Users size={20} />
                <span>Anonymous</span>
              </div>
            </div>

            <div className="input-group">
              {!sharedKey && (
                <input
                  type="text"
                  placeholder="Room ID (optional - auto-generated)"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
                />
              )}
              <button onClick={joinRoom} className="join-btn">
                {sharedKey ? `Join Room ${roomId}` : 'Create New Room'}
              </button>
            </div>
            
            {sharedKey && keyFingerprint && (
              <div className="key-info">
                <Lock size={14} style={{ display: 'inline', marginRight: '4px' }} />
                <span>Encryption key loaded</span>
                <br />
                <small style={{ opacity: 0.7 }}>
                  Key fingerprint: {keyFingerprint}
                </small>
              </div>
            )}
            
            {connectionError && (
              <div className="connection-error">
                <AlertCircle size={16} />
                <span>Connection failed. Check your network.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <InstallPrompt />
      <div className="chat-container">
        <div className="chat-header">
          <div className="header-left">
            <div className={`status-indicator ${connectionError ? 'status-offline' : 'status-online'}`}></div>
            <Lock size={20} />
            <span>Room: {roomId}</span>
            {keyFingerprint && (
              <span className="key-fingerprint" title={`Key fingerprint: ${keyFingerprint}`}>
                🔑 {keyFingerprint.substring(0, 8)}
              </span>
            )}
          </div>
          <div className="header-center">
            <span className="user-badge">{user.displayName}</span>
          </div>
          <div className="header-right">
            {/* ✅ Install Button */}
            <InstallButton />
            
            {roomInfo && roomInfo.exists && (
              <>
                <Clock size={16} />
                <span className="expires-time">
                  {new Date(roomInfo.expires_at).toLocaleTimeString()}
                </span>
              </>
            )}
            <button 
              onClick={() => setDarkMode(!darkMode)} 
              className="icon-btn"
              aria-label="Toggle theme"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button 
              onClick={handleLogout} 
              className="icon-btn"
              aria-label="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {shareableLink && (
          <div className="share-link-container">
            <div className="share-link">
              <span>
                <Lock size={14} style={{ display: 'inline', marginRight: '4px' }} />
                Share this link to invite others:
              </span>
              <div className="link-copy-group">
                <input 
                  type="text" 
                  value={shareableLink} 
                  readOnly 
                  onClick={(e) => e.target.select()}
                />
                <button 
                  onClick={copyShareableLink} 
                  className="copy-btn-inline"
                  aria-label="Copy link"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {connectionError && (
          <div className="connection-warning">
            <AlertCircle size={16} />
            <span>Connection unstable. Messages may not be delivered.</span>
          </div>
        )}

        <div className="messages-container">
          {loadingHistory && (
            <div className="loading-history">
              <History size={20} />
              <span>Loading message history...</span>
            </div>
          )}
          
          {messages.length === 0 && !loadingHistory && (
            <div className="empty-messages">
              <Lock size={48} />
              <p>No messages yet. Start the conversation!</p>
              <small>Messages are end-to-end encrypted</small>
            </div>
          )}
          
          {messages.map((msg, index) => (
            <div 
              key={`${index}-${msg.timestamp}`}
              className={`message ${msg.type} ${msg.isMine ? 'mine' : 'theirs'} ${msg.deleted ? 'deleted' : ''} ${msg.encrypted ? 'encrypted-error' : ''}`}
            >
              {msg.type === 'system' ? (
                <span className="system-message">{msg.text}</span>
              ) : (
                <div className="message-content">
                  {!msg.isMine && <div className="message-username">{msg.username}</div>}
                  <p>{msg.text}</p>
                  
                  {msg.selfDestruct && !msg.deleted && (
                    <div className="self-destruct-indicator">
                      <Timer size={12} />
                      <span>Self-destructing in 1 min</span>
                    </div>
                  )}
                  
                  {!msg.encrypted && !msg.deleted && (
                    <div className="message-actions">
                      {reactionEmojis.map(emoji => (
                        <button 
                          key={emoji}
                          className="message-action-btn" 
                          onClick={() => addReaction(index, emoji)}
                          aria-label={`React with ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {messageReactions[index] && (
                    <div className="message-reactions">
                      {Object.entries(messageReactions[index]).map(([emoji, count]) => (
                        <span key={emoji} className="reaction-badge">
                          {emoji} {count}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {msg.timestamp && (
                    <span className="timestamp">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
          
          {Array.from(typingUsers).map(username => (
            <TypingIndicator key={username} username={username} />
          ))}
          
          <div ref={messagesEndRef} />
        </div>

        <div className="input-container">
          <button
            className={`self-destruct-btn ${selfDestructMode ? 'active' : ''}`}
            onClick={() => setSelfDestructMode(!selfDestructMode)}
            title="Self-destruct message (1 minute)"
            aria-label="Toggle self-destruct"
          >
            <Timer size={20} />
          </button>
          
          <button
            className="emoji-btn"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            aria-label="Emoji picker"
          >
            <Smile size={20} />
          </button>
          
          {showEmojiPicker && (
            <div className="emoji-picker">
              {quickEmojis.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  className="emoji-option"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          
          <input
            type="text"
            placeholder={connectionError ? "Reconnecting..." : "Type your message..."}
            value={inputMessage}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            disabled={!ws || ws.readyState !== WebSocket.OPEN}
          />
          
          <button 
            onClick={sendMessage} 
            className="send-btn"
            disabled={!inputMessage.trim() || !ws || ws.readyState !== WebSocket.OPEN}
            aria-label="Send message"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;

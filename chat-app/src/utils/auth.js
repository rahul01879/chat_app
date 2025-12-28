const DB_NAME = 'SecureChatAuth';
const DB_VERSION = 1;
const STORE_NAME = 'users';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'username' });
        // Create index for faster lookups
        objectStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
};

export const deriveKey = async (password, salt) => {
  const encoder = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
};

export const encryptData = async (data, password) => {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  
  const encoder = new TextEncoder();
  const encryptedData = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(data))
  );
  
  return {
    encrypted: arrayBufferToBase64(encryptedData),
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv)
  };
};

export const decryptData = async (encryptedObj, password) => {
  if (!encryptedObj || !encryptedObj.salt || !encryptedObj.iv || !encryptedObj.encrypted) {
    throw new Error('Invalid encrypted data format');
  }

  const salt = base64ToArrayBuffer(encryptedObj.salt);
  const iv = base64ToArrayBuffer(encryptedObj.iv);
  const encrypted = base64ToArrayBuffer(encryptedObj.encrypted);
  
  const key = await deriveKey(password, salt);
  
  try {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Invalid password');
  }
};

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

const base64ToArrayBuffer = (base64) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const registerUser = async (username, password, displayName) => {
  // Validate inputs
  if (!username || !password || !displayName) {
    throw new Error('All fields are required');
  }

  if (username.length < 3) {
    throw new Error('Username must be at least 3 characters');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  // Encrypt data BEFORE starting transaction
  const encryptedData = await encryptData(
    { 
      username, 
      displayName, 
      createdAt: new Date().toISOString() 
    },
    password
  );

  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      // Check if user exists
      const checkRequest = store.get(username);
      
      checkRequest.onsuccess = () => {
        if (checkRequest.result) {
          reject(new Error('Username already exists'));
          return;
        }
        
        // Add new user - data is already encrypted
        const addRequest = store.add({
          username,
          ...encryptedData,
          createdAt: new Date().toISOString()
        });
        
        addRequest.onsuccess = () => {
          console.log('User registered successfully');
          resolve(true);
        };
        
        addRequest.onerror = () => {
          console.error('Add request error:', addRequest.error);
          reject(new Error('Failed to create user'));
        };
      };
      
      checkRequest.onerror = () => {
        console.error('Check request error:', checkRequest.error);
        reject(new Error('Database error'));
      };
      
      transaction.oncomplete = () => {
        console.log('Transaction completed successfully');
      };
      
      transaction.onerror = () => {
        console.error('Transaction error:', transaction.error);
        reject(new Error('Transaction failed'));
      };
      
      transaction.onabort = () => {
        console.error('Transaction aborted');
        reject(new Error('Transaction aborted'));
      };
    } catch (error) {
      console.error('Register error:', error);
      reject(error);
    }
  });
};

export const loginUser = async (username, password) => {
  // Validate inputs
  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.get(username);
      
      request.onsuccess = async () => {
        if (!request.result) {
          reject(new Error('User not found'));
          return;
        }
        
        try {
          // Decrypt data AFTER getting it from database
          const decryptedData = await decryptData(request.result, password);
          console.log('Login successful');
          resolve(decryptedData);
        } catch (error) {
          console.error('Decryption failed:', error);
          reject(new Error('Invalid password'));
        }
      };
      
      request.onerror = () => {
        console.error('Get request error:', request.error);
        reject(new Error('Failed to retrieve user'));
      };
      
      transaction.onerror = () => {
        console.error('Transaction error:', transaction.error);
        reject(new Error('Transaction failed'));
      };
    } catch (error) {
      console.error('Login error:', error);
      reject(error);
    }
  });
};

export const getAllUsers = async () => {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    const request = store.getAllKeys();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(new Error('Failed to retrieve users'));
  });
};

export const deleteUser = async (username) => {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const request = store.delete(username);
    
    request.onsuccess = () => {
      console.log('User deleted successfully');
      resolve(true);
    };
    
    request.onerror = () => {
      console.error('Delete request error:', request.error);
      reject(new Error('Failed to delete user'));
    };
  });
};

export const changePassword = async (username, oldPassword, newPassword) => {
  // Validate inputs
  if (!username || !oldPassword || !newPassword) {
    throw new Error('All fields are required');
  }

  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters');
  }

  const db = await openDB();
  
  return new Promise(async (resolve, reject) => {
    try {
      // First verify old password
      const transaction1 = db.transaction([STORE_NAME], 'readonly');
      const store1 = transaction1.objectStore(STORE_NAME);
      const getRequest = store1.get(username);
      
      getRequest.onsuccess = async () => {
        if (!getRequest.result) {
          reject(new Error('User not found'));
          return;
        }
        
        try {
          // Decrypt with old password
          const userData = await decryptData(getRequest.result, oldPassword);
          
          // Re-encrypt with new password
          const newEncryptedData = await encryptData(userData, newPassword);
          
          // Update in database
          const transaction2 = db.transaction([STORE_NAME], 'readwrite');
          const store2 = transaction2.objectStore(STORE_NAME);
          
          const updateRequest = store2.put({
            username,
            ...newEncryptedData,
            createdAt: getRequest.result.createdAt
          });
          
          updateRequest.onsuccess = () => {
            console.log('Password changed successfully');
            resolve(true);
          };
          
          updateRequest.onerror = () => {
            reject(new Error('Failed to update password'));
          };
        } catch (error) {
          reject(new Error('Invalid old password'));
        }
      };
      
      getRequest.onerror = () => {
        reject(new Error('Database error'));
      };
    } catch (error) {
      reject(error);
    }
  });
};

export const userExists = async (username) => {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    const request = store.get(username);
    
    request.onsuccess = () => {
      resolve(!!request.result);
    };
    
    request.onerror = () => {
      reject(new Error('Failed to check user'));
    };
  });
};

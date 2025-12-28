// crypto.js - Enhanced Web Crypto API utilities

/**
 * Generate RSA-OAEP key pair for asymmetric encryption
 * (Currently unused but available for future features)
 */
export const generateKeyPair = async () => {
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"]
    );
    return keyPair;
  } catch (error) {
    console.error("Failed to generate key pair:", error);
    throw new Error("Key pair generation failed");
  }
};

/**
 * Generate AES-GCM shared key for symmetric encryption
 * This key must be shared with all participants for E2E encryption
 */
export const generateSharedKey = async () => {
  try {
    const key = await window.crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
    
    console.log("✅ New AES-GCM key generated");
    return key;
  } catch (error) {
    console.error("Failed to generate shared key:", error);
    throw new Error("Shared key generation failed");
  }
};

/**
 * Encrypt message using AES-GCM
 * @param {string} message - Plain text message to encrypt
 * @param {CryptoKey} key - AES-GCM encryption key
 * @returns {Object} Object containing encrypted data and IV in base64
 */
export const encryptMessage = async (message, key) => {
  try {
    // Validate inputs
    if (!message || typeof message !== 'string') {
      throw new Error("Invalid message: must be a non-empty string");
    }
    
    if (!key || key.type !== 'secret') {
      throw new Error("Invalid key: must be a valid CryptoKey");
    }

    // Generate random 12-byte IV (recommended for AES-GCM)
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedMessage = new TextEncoder().encode(message);
    
    const encryptedData = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
        tagLength: 128, // Explicit authentication tag length
      },
      key,
      encodedMessage
    );
    
    const result = {
      encrypted: arrayBufferToBase64(encryptedData),
      iv: arrayBufferToBase64(iv),
    };
    
    // Debug log (remove in production)
    console.log("🔒 Message encrypted:", {
      messageLength: message.length,
      encryptedLength: result.encrypted.length,
      ivLength: result.iv.length
    });
    
    return result;
  } catch (error) {
    console.error("Encryption failed:", error);
    throw new Error(`Encryption failed: ${error.message}`);
  }
};

/**
 * Decrypt message using AES-GCM
 * @param {string} encryptedData - Base64 encoded encrypted data
 * @param {string} iv - Base64 encoded initialization vector
 * @param {CryptoKey} key - AES-GCM decryption key
 * @returns {string} Decrypted plain text message
 */
export const decryptMessage = async (encryptedData, iv, key) => {
  try {
    // Validate inputs
    if (!encryptedData || typeof encryptedData !== 'string') {
      throw new Error("Invalid encrypted data: must be a base64 string");
    }
    
    if (!iv || typeof iv !== 'string') {
      throw new Error("Invalid IV: must be a base64 string");
    }
    
    if (!key || key.type !== 'secret') {
      throw new Error("Invalid key: must be a valid CryptoKey");
    }

    // Convert base64 to ArrayBuffer
    const encryptedBuffer = base64ToArrayBuffer(encryptedData);
    const ivBuffer = base64ToArrayBuffer(iv);
    
    // Validate buffer sizes
    if (ivBuffer.byteLength !== 12) {
      console.warn(`⚠️ Unusual IV length: ${ivBuffer.byteLength} bytes (expected 12)`);
    }
    
    const decryptedData = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBuffer,
        tagLength: 128, // Must match encryption tagLength
      },
      key,
      encryptedBuffer
    );
    
    const decrypted = new TextDecoder().decode(decryptedData);
    
    // Debug log (remove in production)
    console.log("🔓 Message decrypted successfully:", {
      encryptedLength: encryptedData.length,
      decryptedLength: decrypted.length
    });
    
    return decrypted;
  } catch (error) {
    // Detailed error logging for debugging
    console.error("❌ Decryption failed:", {
      errorName: error.name,
      errorMessage: error.message,
      encryptedDataLength: encryptedData?.length,
      ivLength: iv?.length,
      keyType: key?.type,
      keyAlgorithm: key?.algorithm?.name
    });
    
    // Check for common errors
    if (error.name === 'OperationError') {
      console.error("💡 OperationError usually means:");
      console.error("   1. Wrong decryption key (most common)");
      console.error("   2. Corrupted encrypted data");
      console.error("   3. Modified IV or authentication tag");
      throw new Error("Decryption failed: Wrong key or corrupted data");
    } else if (error.name === 'InvalidAccessError') {
      throw new Error("Decryption failed: Key cannot be used for decryption");
    } else {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }
};

/**
 * Convert ArrayBuffer to Base64 string
 * @param {ArrayBuffer} buffer - Buffer to convert
 * @returns {string} Base64 encoded string
 */
const arrayBufferToBase64 = (buffer) => {
  try {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192; // Process in chunks for better performance
    
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
      binary += String.fromCharCode.apply(null, chunk);
    }
    
    return window.btoa(binary);
  } catch (error) {
    console.error("Base64 encoding failed:", error);
    throw new Error("Failed to encode data to base64");
  }
};

/**
 * Convert Base64 string to ArrayBuffer
 * @param {string} base64 - Base64 encoded string
 * @returns {ArrayBuffer} Decoded buffer
 */
const base64ToArrayBuffer = (base64) => {
  try {
    if (!base64 || typeof base64 !== 'string') {
      throw new Error("Invalid base64 string");
    }
    
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    return bytes.buffer;
  } catch (error) {
    console.error("Base64 decoding failed:", error);
    throw new Error("Failed to decode base64 data");
  }
};

/**
 * Export CryptoKey to base64 string for sharing/storage
 * @param {CryptoKey} key - Key to export
 * @returns {string} Base64 encoded key
 */
export const exportKey = async (key) => {
  try {
    if (!key || !key.type) {
      throw new Error("Invalid key: cannot export");
    }
    
    const exported = await window.crypto.subtle.exportKey("raw", key);
    const base64Key = arrayBufferToBase64(exported);
    
    console.log("📤 Key exported:", {
      keyType: key.type,
      algorithm: key.algorithm.name,
      length: key.algorithm.length,
      base64Length: base64Key.length
    });
    
    return base64Key;
  } catch (error) {
    console.error("Key export failed:", error);
    throw new Error(`Key export failed: ${error.message}`);
  }
};

/**
 * Import base64 key string to CryptoKey
 * @param {string} base64Key - Base64 encoded key
 * @returns {CryptoKey} Imported CryptoKey
 */
export const importKey = async (base64Key) => {
  try {
    if (!base64Key || typeof base64Key !== 'string') {
      throw new Error("Invalid base64 key string");
    }
    
    const keyBuffer = base64ToArrayBuffer(base64Key);
    
    // Validate key length (256-bit = 32 bytes)
    if (keyBuffer.byteLength !== 32) {
      console.warn(`⚠️ Unexpected key length: ${keyBuffer.byteLength} bytes (expected 32 for AES-256)`);
    }
    
    const key = await window.crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { 
        name: "AES-GCM",
        length: 256
      },
      true,
      ["encrypt", "decrypt"]
    );
    
    console.log("📥 Key imported successfully:", {
      algorithm: key.algorithm.name,
      length: key.algorithm.length,
      usages: key.usages
    });
    
    return key;
  } catch (error) {
    console.error("Key import failed:", error);
    throw new Error(`Key import failed: ${error.message}`);
  }
};

/**
 * Verify if two keys are identical
 * Useful for debugging key synchronization issues
 * @param {CryptoKey} key1 - First key
 * @param {CryptoKey} key2 - Second key
 * @returns {boolean} True if keys match
 */
export const compareKeys = async (key1, key2) => {
  try {
    const exported1 = await exportKey(key1);
    const exported2 = await exportKey(key2);
    
    const match = exported1 === exported2;
    console.log(`🔍 Keys ${match ? 'MATCH ✅' : 'DO NOT MATCH ❌'}`);
    
    return match;
  } catch (error) {
    console.error("Key comparison failed:", error);
    return false;
  }
};

/**
 * Generate a hash of the key for verification (without exposing the key)
 * @param {CryptoKey} key - Key to hash
 * @returns {string} SHA-256 hash of the key (first 16 chars)
 */
export const getKeyFingerprint = async (key) => {
  try {
    const exported = await exportKey(key);
    const buffer = new TextEncoder().encode(exported);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Return first 16 characters as fingerprint
    const fingerprint = hashHex.substring(0, 16).toUpperCase();
    console.log("🔑 Key fingerprint:", fingerprint);
    
    return fingerprint;
  } catch (error) {
    console.error("Fingerprint generation failed:", error);
    return null;
  }
};

// Export validation utilities
export const validateKey = (key) => {
  if (!key) return { valid: false, error: "Key is null or undefined" };
  if (!key.type) return { valid: false, error: "Invalid key structure" };
  if (key.type !== 'secret') return { valid: false, error: `Expected 'secret' key, got '${key.type}'` };
  if (key.algorithm?.name !== 'AES-GCM') return { valid: false, error: `Expected 'AES-GCM', got '${key.algorithm?.name}'` };
  if (key.algorithm?.length !== 256) return { valid: false, error: `Expected 256-bit key, got ${key.algorithm?.length}-bit` };
  
  return { valid: true };
};

console.log("🔐 Crypto utilities loaded successfully");

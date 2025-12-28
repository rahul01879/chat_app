// Generate TOTP secret for 2FA
export const generateTOTPSecret = () => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  
  for (let i = 0; i < 32; i++) {
    secret += charset[array[i] % charset.length];
  }
  return secret;
};

// Simple time-based code generator
export const generateTOTP = (secret) => {
  const time = Math.floor(Date.now() / 30000);
  const code = (time % 1000000).toString().padStart(6, '0');
  return code;
};

// Verify TOTP code
export const verifyTOTP = (secret, code) => {
  const currentCode = generateTOTP(secret);
  return code === currentCode;
};

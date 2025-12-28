import { useState } from 'react';
import { Lock, User, Eye, EyeOff, Shield, ArrowRight, Sparkles } from 'lucide-react';
import { registerUser, loginUser } from '../utils/auth';
import InstallButton from './InstallButton';
import './Auth.css';

function Auth({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const userData = await loginUser(username, password);
        onLogin(userData);
      } else {
        if (!displayName.trim()) {
          setError('Display name is required');
          setLoading(false);
          return;
        }
        await registerUser(username, password, displayName);
        const userData = await loginUser(username, password);
        onLogin(userData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      {/* Animated background */}
      <div className="auth-bg">
        <div className="auth-bg-gradient"></div>
        <div className="auth-bg-pattern"></div>
      </div>

      <div className="auth-card">
        {/* Header with animated icon */}
        <div className="auth-header">
          <div className="auth-icon">
            <Shield size={40} />
            <div className="auth-icon-glow"></div>
          </div>
          <h1 className="auth-title">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h1>
          <p className="auth-subtitle">
            {isLogin 
              ? 'Login to access your secure chat rooms' 
              : 'Join our end-to-end encrypted platform'}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${isLogin ? 'active' : ''}`}
            onClick={() => {
              setIsLogin(true);
              setError('');
            }}
          >
            Login
          </button>
          <button
            type="button"
            className={`auth-tab ${!isLogin ? 'active' : ''}`}
            onClick={() => {
              setIsLogin(false);
              setError('');
            }}
          >
            Sign Up
          </button>
          <div className={`auth-tab-indicator ${!isLogin ? 'right' : ''}`}></div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label className="form-label">
              <User size={16} />
              <span>Username</span>
            </label>
            <div className="input-wrapper">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                autoComplete="username"
                className="form-input"
              />
              <div className="input-border"></div>
            </div>
          </div>

          {!isLogin && (
            <div className="form-group animate-in">
              <label className="form-label">
                <Sparkles size={16} />
                <span>Display Name</span>
              </label>
              <div className="input-wrapper">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Choose your anonymous identity"
                  required
                  className="form-input"
                />
                <div className="input-border"></div>
              </div>
              <small className="form-hint">
                <Lock size={12} />
                This name will be shown in chat rooms
              </small>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">
              <Lock size={16} />
              <span>Password</span>
            </label>
            <div className="input-wrapper password-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                className="form-input"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="password-toggle"
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
              <div className="input-border"></div>
            </div>
            {!isLogin && (
              <small className="form-hint">
                Minimum 6 characters recommended
              </small>
            )}
          </div>

          {error && (
            <div className="error-message animate-in">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2"/>
                <path d="M8 4V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="8" cy="11.5" r="0.5" fill="currentColor"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          <button 
            type="submit" 
            className="auth-submit" 
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="spinner"></div>
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span>{isLogin ? 'Login to Account' : 'Create Account'}</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        {/* ✅ Install Button */}
        <div className="install-button-container">
          <InstallButton />
        </div>

        {/* Security badge */}
        <div className="security-badge">
          <div className="security-badge-icon">
            <Lock size={14} />
          </div>
          <div className="security-badge-text">
            <strong>End-to-End Encrypted</strong>
            <span>Your data is encrypted locally in your browser</span>
          </div>
        </div>

        {/* Features */}
        {!isLogin && (
          <div className="auth-features">
            <div className="auth-feature">
              <Shield size={16} />
              <span>Secure & Anonymous</span>
            </div>
            <div className="auth-feature">
              <Lock size={16} />
              <span>E2E Encryption</span>
            </div>
            <div className="auth-feature">
              <Sparkles size={16} />
              <span>Auto-Delete Messages</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Auth;

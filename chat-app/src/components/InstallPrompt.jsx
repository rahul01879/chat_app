import { useState, useEffect } from 'react';
import { Download, X, Smartphone, Monitor } from 'lucide-react';
import './InstallPrompt.css';

function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstallable, setIsInstallable] = useState(false);
  const [showManualInstructions, setShowManualInstructions] = useState(false);
  const [platform, setPlatform] = useState('unknown');

  // Detect platform
  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    const isAndroid = /android/.test(userAgent);
    const isDesktop = !isIOS && !isAndroid;

    if (isIOS) setPlatform('ios');
    else if (isAndroid) setPlatform('android');
    else if (isDesktop) setPlatform('desktop');

    console.log('🔍 Platform detected:', { isIOS, isAndroid, isDesktop });
  }, []);

  useEffect(() => {
    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isInWebAppiOS = window.navigator.standalone === true;
    
    if (isStandalone || isInWebAppiOS) {
      console.log('✅ App is already installed');
      return;
    }

    // Listen for beforeinstallprompt (Chrome, Edge, Samsung Internet)
    const handler = (e) => {
      e.preventDefault();
      console.log('✅ beforeinstallprompt event fired');
      setDeferredPrompt(e);
      setIsInstallable(true);
      
      // Show prompt after 5 seconds (reduced from 10)
      setTimeout(() => {
        const dismissed = localStorage.getItem('installPromptDismissed');
        if (dismissed) {
          const dismissedTime = parseInt(dismissed);
          const weekInMs = 7 * 24 * 60 * 60 * 1000;
          if (Date.now() - dismissedTime < weekInMs) {
            console.log('⏭️ Install prompt dismissed recently, not showing');
            return;
          }
        }
        setShowPrompt(true);
      }, 5000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Debug: Check if event was fired
    setTimeout(() => {
      if (!isInstallable) {
        console.log('⚠️ beforeinstallprompt did NOT fire yet');
        console.log('💡 This is normal on iOS or if user needs more engagement time');
        console.log('📱 Platform:', platform);
        
        // On iOS or if event doesn't fire, show manual instructions after 10 seconds
        if (platform === 'ios' || !isInstallable) {
          setTimeout(() => {
            const dismissed = localStorage.getItem('installPromptDismissed');
            if (!dismissed || (Date.now() - parseInt(dismissed)) > 7 * 24 * 60 * 60 * 1000) {
              setShowManualInstructions(true);
            }
          }, 10000);
        }
      }
    }, 6000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, [isInstallable, platform]);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      console.log('❌ No install prompt available');
      // Show manual instructions instead
      setShowManualInstructions(true);
      return;
    }

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      console.log(`User response: ${outcome}`);
      
      if (outcome === 'accepted') {
        console.log('✅ User installed the app');
        setShowPrompt(false);
        setShowManualInstructions(false);
      } else {
        console.log('❌ User dismissed the install prompt');
      }
      
      setDeferredPrompt(null);
    } catch (error) {
      console.error('Install error:', error);
      setShowManualInstructions(true);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setShowManualInstructions(false);
    localStorage.setItem('installPromptDismissed', Date.now().toString());
    console.log('💾 Install prompt dismissed, will not show for 7 days');
  };

  const handleShowInstructions = () => {
    setShowPrompt(false);
    setShowManualInstructions(true);
  };

  // Show debug info in console
  useEffect(() => {
    console.log('PWA Debug Info:', {
      platform,
      isInstallable,
      hasDeferredPrompt: !!deferredPrompt,
      showPrompt,
      showManualInstructions,
      isStandalone: window.matchMedia('(display-mode: standalone)').matches,
      isInWebAppiOS: window.navigator.standalone === true
    });
  }, [platform, isInstallable, deferredPrompt, showPrompt, showManualInstructions]);

  // Automatic install prompt (Chrome, Edge)
  if (showPrompt && deferredPrompt) {
    return (
      <div className="install-prompt">
        <div className="install-prompt-content">
          <div className="install-prompt-icon">
            <Download size={24} />
          </div>
          <div className="install-prompt-text">
            <h3>Install App</h3>
            <p>Get quick access and offline support</p>
          </div>
          <div className="install-prompt-actions">
            <button onClick={handleInstall} className="install-btn">
              Install
            </button>
            <button onClick={handleDismiss} className="dismiss-btn" aria-label="Dismiss">
              <X size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Manual installation instructions (iOS, Safari, or fallback)
  if (showManualInstructions) {
    return (
      <div className="install-prompt manual">
        <div className="install-prompt-content manual-instructions">
          <button onClick={handleDismiss} className="dismiss-btn-top" aria-label="Close">
            <X size={18} />
          </button>
          
          <div className="install-prompt-icon">
            {platform === 'ios' ? <Smartphone size={28} /> : <Monitor size={28} />}
          </div>
          
          <h3>Install Encrypted Chat</h3>
          
          {platform === 'ios' && (
            <div className="install-steps">
              <p>Tap the <strong>Share</strong> button <span className="share-icon">⬆️</span></p>
              <p>Then tap <strong>"Add to Home Screen"</strong></p>
              <div className="install-visual">
                <span className="ios-instruction">📱 Safari → Share → Add to Home Screen</span>
              </div>
            </div>
          )}
          
          {platform === 'android' && (
            <div className="install-steps">
              <p>Tap the <strong>menu</strong> <span className="menu-icon">⋮</span></p>
              <p>Then tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></p>
              <div className="install-visual">
                <span className="android-instruction">📱 Chrome → Menu → Install app</span>
              </div>
            </div>
          )}
          
          {platform === 'desktop' && (
            <div className="install-steps">
              <p>Click the <strong>menu</strong> icon <span className="menu-icon">⋮</span> in your browser</p>
              <p>Then select <strong>"Install Encrypted Chat"</strong></p>
              <div className="install-visual">
                <span className="desktop-instruction">💻 Browser Menu → Install Encrypted Chat</span>
              </div>
            </div>
          )}
          
          <button onClick={handleDismiss} className="got-it-btn">
            Got it!
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default InstallPrompt;

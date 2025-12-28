import { useState, useEffect } from 'react';
import { Download, CheckCircle, Smartphone } from 'lucide-react';
import './InstallButton.css';

function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed
    const checkInstalled = 
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    
    setIsInstalled(checkInstalled);

    if (checkInstalled) {
      console.log('✅ App is already installed');
      return;
    }

    // Capture the install prompt
    const handler = (e) => {
      e.preventDefault();
      console.log('✅ Install prompt captured');
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      // Show browser-specific instructions
      alert(
        '📱 To install this app:\n\n' +
        '🖥️ Desktop (Chrome/Edge):\n' +
        '   • Click the ⋮ menu\n' +
        '   • Select "Install Encrypted Chat"\n\n' +
        '📱 Android (Chrome):\n' +
        '   • Tap the ⋮ menu\n' +
        '   • Tap "Install app"\n\n' +
        '🍎 iOS (Safari):\n' +
        '   • Tap the Share button ⬆️\n' +
        '   • Tap "Add to Home Screen"'
      );
      return;
    }

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('✅ App installed');
        setIsInstalled(true);
      }
      
      setDeferredPrompt(null);
    } catch (error) {
      console.error('Install error:', error);
    }
  };

  if (isInstalled) {
    return (
      <div className="install-button installed">
        <CheckCircle size={16} />
        <span>App Installed</span>
      </div>
    );
  }

  return (
    <button onClick={handleInstallClick} className="install-button">
      <Download size={16} />
      <span>Install App</span>
    </button>
  );
}

export default InstallButton;

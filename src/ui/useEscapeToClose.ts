import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useEscapeToClose(visible: boolean, onClose: () => void): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);
}

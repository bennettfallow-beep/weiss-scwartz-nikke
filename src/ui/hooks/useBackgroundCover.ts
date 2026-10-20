// When the app leaves the screen (another app, the lock screen, a hidden
// browser tab), hot-seat play must show the handoff screen on return.
import { useEffect } from 'react';
import { AppState } from 'react-native';

export function useBackgroundCover(onBackground: () => void): void {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') onBackground();
    });
    return () => sub.remove();
  }, [onBackground]);
}

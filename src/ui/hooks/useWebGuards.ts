// Web only: no pull-to-refresh bounce, and a warning before leaving the page
// while a game is on (M5 has no saves yet, so leaving loses the game).
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useWebGuards(gameOn: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';
    return undefined;
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !gameOn) return undefined;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [gameOn]);
}

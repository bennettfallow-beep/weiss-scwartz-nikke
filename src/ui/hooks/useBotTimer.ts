// Runs the computer player's next decision after a short pause.
import { useEffect } from 'react';

import { botToMove } from '../../session';
import type { Session } from '../../session';
import { BOT_DELAY_MS } from '../platform/speed';

export function useBotTimer(session: Session | null, step: () => void): void {
  useEffect(() => {
    if (!session || !botToMove(session)) return undefined;
    const t = setTimeout(step, BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [session, step]);
}

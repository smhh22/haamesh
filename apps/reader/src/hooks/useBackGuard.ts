import { useEffect, useRef } from 'react';
import { armBackGuard } from '../services/backNavigation';

/**
 * While `active` is true, the system back gesture (Android) and the browser
 * Back button close this screen instead of leaving the app (ADR-0029). The
 * handler is read through a ref so a screen that re-renders with new state
 * (a nested group, say) keeps working without re-arming history.
 */
export const useBackGuard = (active: boolean, onBack: () => void): void => {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    return armBackGuard(() => onBackRef.current());
  }, [active]);
};

import { ConnectionPill as UiConnectionPill, ToastStack } from '@tt/ui';

import { useGameStore } from './store';

/**
 * The two design-system components that need live transport state.
 *
 * `@tt/ui` keeps them purely presentational so the design system carries no
 * dependency on this app's store; these are the four lines that bind them.
 */

export function ConnectionPill({ className }: { className?: string }): JSX.Element {
  const status = useGameStore((s) => s.connectionStatus);
  const latencyMs = useGameStore((s) => s.latencyMs);
  return <UiConnectionPill status={status} latencyMs={latencyMs} className={className} />;
}

/** Mounted once, at the app root — screens never render it. */
export function Toaster(): JSX.Element {
  const toasts = useGameStore((s) => s.toasts);
  const dismiss = useGameStore((s) => s.dismissToast);
  return <ToastStack toasts={toasts} onDismiss={dismiss} />;
}

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { Button } from './Button';
import { Panel } from './Panel';
import { IconWarning } from './icons';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level error boundary.
 *
 * Quality bar U9 — the player must never be shown a blank screen. If a render
 * throws, we keep the game's own chrome and offer the two recoveries that
 * actually work: re-render in place, or reload (the session token in
 * localStorage puts the player straight back into their seat).
 *
 * Deliberately a class component: React has no hook equivalent for
 * `componentDidCatch`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as a console report rather than a remote logger: the shell has no
    // telemetry dependency, and the stack is what a developer needs here.
    console.error('[tabletop] render failure', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  private readonly reload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="tt-screen tt-crash">
        <Panel title="Something broke" ticks className="tt-crash__panel" padding="roomy">
          <div className="tt-crash__icon">
            <IconWarning />
          </div>
          <p className="tt-body">
            The interface hit an unexpected error. Your game is stored on the server, not in
            this tab &mdash; reloading will put you back in your seat with everything intact.
          </p>
          <pre className="tt-crash__detail">{error.message}</pre>
          <div className="tt-crash__actions">
            <Button variant="ghost" onClick={this.reset}>
              Try again
            </Button>
            <Button variant="primary" onClick={this.reload}>
              Reload and resume
            </Button>
          </div>
        </Panel>
      </div>
    );
  }
}

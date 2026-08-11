import { Button, IconChevronLeft, Panel } from '@tt/ui';
import { motion } from 'framer-motion';

import { navigate } from '@/router';

import { PortalBackdrop, PortalMark } from './Chrome';

/**
 * Unknown URL.
 *
 * Real routing means real 404s — a mistyped join code or a link to a game this
 * deployment does not host. It stays inside the shell rather than showing the
 * browser's own error page, so the player is one click from the catalogue.
 */
export function NotFound({ path }: { path: string }): JSX.Element {
  return (
    <div className="tt-screen">
      <PortalBackdrop />

      <header className="tt-topbar">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconChevronLeft />}
          onClick={() => navigate({ name: 'portal' })}
        >
          All games
        </Button>
        <PortalMark compact />
        <span />
      </header>

      <main className="tt-crash">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        >
          <Panel tone="glass" padding="roomy" className="tt-crash__panel" ticks>
            <h1 className="tt-h2">Nothing here</h1>
            <p className="tt-body">
              There is no page at <code className="tt-kbd">{path}</code>.
            </p>
            <div className="tt-crash__actions">
              <Button variant="primary" onClick={() => navigate({ name: 'portal' })}>
                Browse the games
              </Button>
              <Button
                variant="ghost"
                onClick={() => navigate({ name: 'join', code: null })}
              >
                Join with a code
              </Button>
            </div>
          </Panel>
        </motion.div>
      </main>
    </div>
  );
}

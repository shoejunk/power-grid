import { Button, IconLogout, IconUsers } from '@tt/ui';
import { useState } from 'react';

import { net, useGameStore } from '@/net';

/** The account control shared by the portal, setup and join shells. */
export function AuthControls(): JSX.Element | null {
  const auth = useGameStore((state) => state.auth);
  const [loggingOut, setLoggingOut] = useState(false);

  if (auth.loading || !auth.configured) return null;

  if (!auth.account) {
    return (
      <Button variant="secondary" size="sm" icon={<IconUsers />} onClick={() => net.login()}>
        Sign in with Google
      </Button>
    );
  }

  return (
    <div className="tt-account-control">
      <span className="tt-account-control__identity" title={auth.account.email}>
        {auth.account.name}
      </span>
      <Button
        variant="ghost"
        size="sm"
        icon={<IconLogout />}
        loading={loggingOut}
        onClick={() => {
          setLoggingOut(true);
          void net.logout().finally(() => setLoggingOut(false));
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

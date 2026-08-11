import {
  Button,
  CodeInput,
  IconChevronLeft,
  IconLink,
  IconUsers,
  IconWarning,
  Panel,
  springSnappy,
  staggerContainer,
  staggerItem,
  TextInput,
} from '@tt/ui';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { ConnectionPill, net, useGameStore } from '@/net';
import { navigate } from '@/router';

import { PortalBackdrop, PortalMark } from './Chrome';

const CODE_LENGTH = 6;

/**
 * Join-by-code.
 *
 * Single-purpose screen: a segmented six-character code field and a name. The
 * code field auto-advances and auto-submits when the last cell is filled, so
 * the common path is "paste, press enter" — or, when the player followed a
 * `/join/ABC123` link, nothing at all.
 *
 * Game-agnostic on purpose: the code is what routes the player, and the server
 * answers with the right game. Nothing here needs to know which one it was.
 */
export function JoinGame({ initialCode }: { initialCode: string | null }): JSX.Element {
  const storedName = useGameStore((s) => s.playerName);
  const pending = useGameStore((s) => s.pending);
  const lastError = useGameStore((s) => s.lastError);
  const clearError = useGameStore((s) => s.clearError);
  const status = useGameStore((s) => s.connectionStatus);

  const [code, setCode] = useState(initialCode ?? '');
  const [name, setName] = useState(storedName);
  const [touched, setTouched] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const nameValid = name.trim().length >= 2;
  const codeValid = code.length === CODE_LENGTH;
  const canSubmit = nameValid && codeValid && status === 'connected' && !pending;

  /* A rejected code should not silently persist as an error on the next keystroke. */
  useEffect(() => {
    if (lastError !== null && code.length < CODE_LENGTH) clearError();
  }, [code, lastError, clearError]);

  /* Arriving on a `/join/CODE` link with a name already stored is the whole
     point of the link: put the cursor where the remaining work is. */
  useEffect(() => {
    if (initialCode !== null && !nameValid) nameRef.current?.focus();
  }, [initialCode, nameValid]);

  const submit = (): void => {
    setTouched(true);
    if (!canSubmit) return;
    net.joinGame(code, name.trim());
  };

  return (
    <div className="tt-screen tt-join">
      <PortalBackdrop />

      <header className="tt-topbar">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconChevronLeft />}
          onClick={() => navigate({ name: 'portal' })}
        >
          Back
        </Button>
        <PortalMark compact />
        <ConnectionPill />
      </header>

      <main className="tt-join__main">
        <motion.div
          className="tt-join__card"
          variants={staggerContainer(0.07, 0.05)}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem} className="tt-join__heading">
            <span className="tt-overline">Join an existing table</span>
            <h1 className="tt-h2">Enter the game code</h1>
            <p className="tt-caption">
              Six characters from the host&rsquo;s lobby. Case does not matter.
            </p>
          </motion.div>

          <motion.div variants={staggerItem}>
            <Panel tone="glass" padding="roomy" ticks>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
                className="tt-join__form"
              >
                <div className="tt-join__codewrap">
                  <CodeInput
                    value={code}
                    onChange={setCode}
                    length={CODE_LENGTH}
                    autoFocus={initialCode === null}
                    label="Game code"
                    error={
                      lastError !== null && codeValid
                        ? 'No open game with that code.'
                        : touched && !codeValid
                          ? 'The code is six characters long.'
                          : null
                    }
                    onComplete={() => {
                      // Jump to the name field if it still needs filling in,
                      // otherwise submit outright.
                      if (!nameValid) nameRef.current?.focus();
                      else submit();
                    }}
                  />
                </div>

                <TextInput
                  ref={nameRef}
                  label="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="e.g. Friedemann"
                  maxLength={18}
                  showCount
                  icon={<IconUsers />}
                  error={touched && !nameValid ? 'Enter at least 2 characters.' : null}
                />

                {lastError !== null ? (
                  <motion.div
                    className="tt-inline-error"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springSnappy}
                    role="alert"
                  >
                    <IconWarning />
                    <span>
                      <strong>{lastError.code}</strong> &mdash; {lastError.message}
                    </span>
                  </motion.div>
                ) : null}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  icon={<IconLink />}
                  loading={pending}
                  disabled={!canSubmit}
                >
                  Join game
                </Button>
              </form>
            </Panel>
          </motion.div>

          <motion.div variants={staggerItem} className="tt-join__alt">
            <span className="tt-caption">No code?</span>
            <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'portal' })}>
              Browse the games
            </Button>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}

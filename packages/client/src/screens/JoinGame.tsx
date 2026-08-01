import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { RULES } from '../data/rules';
import { net, useGameStore } from '../net';
import { springSnappy, staggerContainer, staggerItem } from '../styles/motion';
import {
  Button,
  CodeInput,
  ConnectionPill,
  Hint,
  IconChevronLeft,
  IconLink,
  IconPlus,
  IconUsers,
  IconWarning,
  Panel,
  TextInput,
} from '../ui';
import { AmbientBackdrop, Wordmark } from '../ui/Artwork';

const CODE_LENGTH = 6;

/**
 * Join-by-code.
 *
 * Single-purpose screen: a segmented six-character code field and a name. The
 * code field auto-advances and auto-submits when the last cell is filled, so
 * the common path is "paste, press enter" — or nothing at all.
 */
export function JoinGame(): JSX.Element {
  const setRoute = useGameStore((s) => s.setRoute);
  const storedName = useGameStore((s) => s.playerName);
  const pending = useGameStore((s) => s.pending);
  const lastError = useGameStore((s) => s.lastError);
  const clearError = useGameStore((s) => s.clearError);
  const status = useGameStore((s) => s.connectionStatus);

  const [code, setCode] = useState('');
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

  const submit = (): void => {
    setTouched(true);
    if (!canSubmit) return;
    net.joinGame(code, name.trim());
  };

  return (
    <div className="pg-screen pg-join">
      <AmbientBackdrop />

      <header className="pg-topbar">
        <Button variant="ghost" size="sm" icon={<IconChevronLeft />} onClick={() => setRoute('menu')}>
          Back
        </Button>
        <Wordmark compact />
        <ConnectionPill />
      </header>

      <main className="pg-join__main">
        <motion.div
          className="pg-join__card"
          variants={staggerContainer(0.07, 0.05)}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem} className="pg-join__heading">
            <span className="pg-overline">Join an existing table</span>
            <h1 className="pg-h2">Enter the game code</h1>
            <p className="pg-caption">
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
                className="pg-join__form"
              >
                <div className="pg-join__codewrap">
                  <CodeInput
                    value={code}
                    onChange={setCode}
                    length={CODE_LENGTH}
                    autoFocus
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
                  <Hint {...RULES.gameCode!} placement="right" />
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
                    className="pg-inline-error"
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

          <motion.div variants={staggerItem} className="pg-join__alt">
            <span className="pg-caption">No code?</span>
            <Button variant="ghost" size="sm" icon={<IconPlus />} onClick={() => setRoute('create')}>
              Host your own
            </Button>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}

/**
 * `@tt/ui` — the platform's design system.
 *
 * Source-only: the consuming app's bundler compiles this package, so a change
 * here is visible in the running client without a build step.
 *
 * The rule that keeps it reusable is the same one `@tt/core` follows: nothing
 * exported from here may know what game is being played. A component that
 * needs a seat colour takes it as a prop; a component that needs a currency
 * symbol does not belong here at all.
 *
 * Styles are imported separately — `@tt/ui/styles/index.scss` — because they
 * are a side effect, and a barrel that pulls in a stylesheet cannot be
 * tree-shaken.
 */

export * from './components';
export * from './styles/motion';
export * from './types';

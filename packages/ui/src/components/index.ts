/**
 * UI primitives.
 *
 * Every visual control on the platform comes from this barrel. Screens must
 * not hand-roll buttons, inputs or surfaces — if something is missing, it
 * belongs here so the whole product keeps one physical language.
 */
export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { CodeInput } from './CodeInput';
export type { CodeInputProps } from './CodeInput';

export { ConfirmDialog } from './ConfirmDialog';

export { ConnectionPill } from './ConnectionPill';
export type { ConnectionPillProps } from './ConnectionPill';

export { ErrorBoundary } from './ErrorBoundary';

export { GameTheme, themeVars } from './GameTheme';
export type { GameThemeProps } from './GameTheme';

export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';

export { LoadingSpinner } from './LoadingSpinner';
export type { LoadingSpinnerProps } from './LoadingSpinner';

export { Modal } from './Modal';
export type { ModalProps } from './Modal';

export { NumberStepper } from './NumberStepper';
export type { NumberStepperProps } from './NumberStepper';

export { Panel } from './Panel';
export type { PanelPadding, PanelProps, PanelTone } from './Panel';

export { Avatar, ColorPicker, PlayerChip } from './PlayerChip';
export type {
  AvatarProps,
  ColorPickerProps,
  PlayerChipProps,
  SeatColorOption,
  SeatTint,
} from './PlayerChip';

export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';

export { Slider } from './Slider';
export type { SliderProps } from './Slider';

export { Tabs } from './Tabs';
export type { TabItem, TabsProps } from './Tabs';

export { TextInput } from './TextInput';
export type { TextInputProps } from './TextInput';

export { ToastStack } from './Toast';
export type { ToastStackProps } from './Toast';

export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';

export { Hint, Tooltip } from './Tooltip';
export type { HintProps, TooltipPlacement, TooltipProps } from './Tooltip';

export * from './icons';

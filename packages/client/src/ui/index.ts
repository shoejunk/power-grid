/**
 * UI primitives.
 *
 * Every visual control in the game comes from this barrel. Screens must not
 * hand-roll buttons, inputs or surfaces — if something is missing, it belongs
 * here so the whole product keeps one physical language.
 */
export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { CodeInput } from './CodeInput';
export type { CodeInputProps } from './CodeInput';

export { ConnectionPill } from './ConnectionPill';

export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';

export { LoadingSpinner } from './LoadingSpinner';
export type { LoadingSpinnerProps } from './LoadingSpinner';

export { Modal } from './Modal';
export type { ModalProps } from './Modal';

export { Money } from './Money';
export type { MoneyProps, MoneySize, MoneyTone } from './Money';

export { NumberStepper } from './NumberStepper';
export type { NumberStepperProps } from './NumberStepper';

export { Panel } from './Panel';
export type { PanelPadding, PanelProps, PanelTone } from './Panel';

export {
  Avatar,
  ColorPicker,
  PLAYER_COLOR_LABEL,
  PLAYER_COLOR_ORDER,
  PLAYER_SIGIL,
  PlayerChip,
} from './PlayerChip';
export type { AvatarProps, ColorPickerProps, PlayerChipProps } from './PlayerChip';

export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';

export { Slider } from './Slider';
export type { SliderProps } from './Slider';

export { Tabs } from './Tabs';
export type { TabItem, TabsProps } from './Tabs';

export { TextInput } from './TextInput';
export type { TextInputProps } from './TextInput';

export { Toaster } from './Toast';

export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';

export { Hint, Tooltip } from './Tooltip';
export type { HintProps, TooltipPlacement, TooltipProps } from './Tooltip';

export * from './icons';

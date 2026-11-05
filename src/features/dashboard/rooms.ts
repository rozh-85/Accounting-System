import { BookText, Landmark, NotebookPen, Scale, type LucideIcon } from 'lucide-react';

export interface RoomColor {
  /** Icon / label color. */
  text: string;
  /** Soft tile background. */
  soft: string;
  /** Solid bar color. */
  bar: string;
  /** Border color on hover (tiles). */
  hoverBorder: string;
}

export interface RoomDefinition {
  key: 'journal' | 'ledger' | 'trialBalance' | 'financialPosition';
  number: string;
  path: string;
  icon: LucideIcon;
  color: RoomColor;
}

/** Category colors (full class names so Tailwind generates them). */
export const COLORS = {
  blue: { text: 'text-accent', soft: 'bg-accent-soft', bar: 'bg-accent', hoverBorder: 'hover:border-accent-line' },
  teal: { text: 'text-info', soft: 'bg-info-soft', bar: 'bg-info', hoverBorder: 'hover:border-info-line' },
  purple: { text: 'text-purple', soft: 'bg-purple-soft', bar: 'bg-purple', hoverBorder: 'hover:border-purple-line' },
  green: { text: 'text-success', soft: 'bg-success-soft', bar: 'bg-success', hoverBorder: 'hover:border-success-line' },
  orange: { text: 'text-orange', soft: 'bg-orange-soft', bar: 'bg-orange', hoverBorder: 'hover:border-orange-line' },
  amber: { text: 'text-warning', soft: 'bg-warning-soft', bar: 'bg-warning', hoverBorder: 'hover:border-warning-line' },
  slate: { text: 'text-ink-soft', soft: 'bg-hover', bar: 'bg-ink-soft', hoverBorder: 'hover:border-line-strong' },
} satisfies Record<string, RoomColor>;

/** The four primary rooms of the system, in workflow order. */
export const ROOMS: RoomDefinition[] = [
  { key: 'journal', number: '01', path: '/journal', icon: NotebookPen, color: COLORS.blue },
  { key: 'ledger', number: '02', path: '/ledger', icon: BookText, color: COLORS.teal },
  { key: 'trialBalance', number: '03', path: '/trial-balance', icon: Scale, color: COLORS.purple },
  { key: 'financialPosition', number: '04', path: '/financial-position', icon: Landmark, color: COLORS.green },
];

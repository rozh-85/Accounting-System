import { BookText, Landmark, NotebookPen, Scale, type LucideIcon } from 'lucide-react';

export interface RoomColor {
  /** Icon / label color. */
  text: string;
  /** Soft tile background. */
  soft: string;
  /** Solid bar color. */
  bar: string;
}

export interface RoomDefinition {
  key: 'journal' | 'ledger' | 'trialBalance' | 'financialPosition';
  number: string;
  path: string;
  icon: LucideIcon;
  color: RoomColor;
}

const color = {
  blue: { text: 'text-accent', soft: 'bg-accent-soft', bar: 'bg-accent' },
  teal: { text: 'text-info', soft: 'bg-info-soft', bar: 'bg-info' },
  purple: { text: 'text-purple', soft: 'bg-purple-soft', bar: 'bg-purple' },
  green: { text: 'text-success', soft: 'bg-success-soft', bar: 'bg-success' },
} satisfies Record<string, RoomColor>;

/** The four primary rooms of the system, in workflow order. */
export const ROOMS: RoomDefinition[] = [
  { key: 'journal', number: '01', path: '/journal', icon: NotebookPen, color: color.blue },
  { key: 'ledger', number: '02', path: '/ledger', icon: BookText, color: color.teal },
  { key: 'trialBalance', number: '03', path: '/trial-balance', icon: Scale, color: color.purple },
  { key: 'financialPosition', number: '04', path: '/financial-position', icon: Landmark, color: color.green },
];

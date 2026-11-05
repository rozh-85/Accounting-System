import { BookText, Landmark, NotebookPen, Scale, type LucideIcon } from 'lucide-react';

export interface RoomDefinition {
  key: 'journal' | 'ledger' | 'trialBalance' | 'financialPosition';
  number: string;
  path: string;
  icon: LucideIcon;
}

/** The four primary rooms of the system, in workflow order. */
export const ROOMS: RoomDefinition[] = [
  { key: 'journal', number: '01', path: '/journal', icon: NotebookPen },
  { key: 'ledger', number: '02', path: '/ledger', icon: BookText },
  { key: 'trialBalance', number: '03', path: '/trial-balance', icon: Scale },
  { key: 'financialPosition', number: '04', path: '/financial-position', icon: Landmark },
];

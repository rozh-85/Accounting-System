# Vio Accounting — Color Palette

All colors are design tokens in `src/styles/index.css` (`@theme`). Use the token classes
(`text-success`, `bg-warning-soft`, `border-danger-line` …) — never raw hex values in components.
Each color has a **solid** (text/icons), **soft** (backgrounds) and **line** (borders) step.

## Neutrals

| Token | Hex | Use |
|---|---|---|
| `ink` | `#172438` | Headings, primary text |
| `ink-soft` | `#3A4759` | Body text |
| `muted` | `#637081` | Secondary text, labels |
| `faint` | `#96A0AB` | Placeholders, hints |
| `line` / `line-strong` | `#E4E8EC` / `#CFD6DD` | Borders, dividers |
| `canvas` / `surface` | `#FFFFFF` | Page and card backgrounds |
| `subtle` / `hover` | `#F8F9FA` / `#F2F4F6` | Table headers, hover rows |

## Primary and brand

| Token | Solid | Soft | Line | Use |
|---|---|---|---|---|
| `accent` (primary blue) | `#1F4E8C` | `#EBF2FA` | `#C8D8EC` | Primary buttons, links, focus, active navigation, assets, debit side |
| `brand` (Vio red) | `#A7282C` | — | — | Logo and the letterhead rule at the top of the app only |

## Semantic (status)

| Token | Solid | Soft | Line | Meaning |
|---|---|---|---|---|
| `success` | `#1B7A47` | `#E8F5EE` | `#BDE0CB` | Posted, balanced, open period, active, Post button |
| `warning` | `#A15C07` | `#FDF4E3` | `#F1D8A6` | Pending approval, rejected drafts, abnormal balance |
| `danger` | `#B42318` | `#FDECEB` | `#F4C7C2` | Reversed, out of balance, errors, destructive actions |
| `info` | `#0E6F86` | `#E6F4F7` | `#B9DFE8` | Notices, opening entries, transfers |

## Categories

| Token | Solid | Soft | Line |
|---|---|---|---|
| `orange` | `#C2410C` | `#FDF0E7` | `#F5CFB6` |
| `purple` | `#6941C6` | `#F2EDFB` | `#D6C8F2` |

## Where each color is used

| Item | Color |
|---|---|
| Entry / voucher status | Draft · neutral — Pending approval · warning — Posted · success — Reversed · danger |
| Period status | Open · success — Closed · neutral |
| Account type | Asset · blue — Liability · orange — Equity · purple — Revenue · green — Expense · red |
| Entry type | Standard · neutral — Opening · info — Adjusting · purple — Closing · orange — Reversing · danger — Recurring · blue |
| Voucher type | Receipt · green — Payment · orange — Journal · blue — Transfer · info |
| Rooms | 01 Journal · blue — 02 Ledger · teal — 03 Trial Balance · purple — 04 Financial Position · green |
| Journal form | Debit panel · blue — Credit panel · orange |
| Balance checks | Balanced · success — Out of balance · danger |

All text colors meet WCAG AA contrast (4.5:1) on white and on their own soft background.

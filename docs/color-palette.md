# Vio Accounting — Color Palette

All colors are design tokens in `src/styles/index.css` (`@theme`). Use the token classes
(`text-success`, `bg-warning-soft`, `border-danger-line` …) — never raw hex values in components.
Each color has a **solid** (text/icons), **soft** (backgrounds) and **line** (borders) step.

## Neutrals

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1D2939` | Headings, primary text |
| `ink-soft` | `#344054` | Body text |
| `muted` | `#667085` | Secondary text, labels |
| `faint` | `#98A2B3` | Placeholders, decorative hints only |
| `line` / `line-strong` | `#EAECF0` / `#D0D5DD` | Borders, dividers, inputs |
| `canvas` | `#F4F5F7` | Page background behind the cards |
| `surface` | `#FFFFFF` | Cards, sidebar, top bar |
| `subtle` / `hover` | `#F9FAFB` / `#F2F4F7` | Table headers, hover rows, segmented controls |

## Primary, accent and brand

| Token | Solid | Soft | Line | Use |
|---|---|---|---|---|
| `primary` (Vio red) | `#CF3530` | `#FDEEED` | `#F6CAC7` | Main call-to-action buttons, the active sidebar item, active tab underline, count badges in the sidebar (white text 5.0:1) |
| `accent` (blue) | `#2563C9` | `#EBF2FD` | `#C7D9F6` | Links, focus rings, assets, the journal room (5.7:1 on white) |
| `brand` (Vio logo red) | `#A7282C` | — | — | Logo and the sign-in brand panel |

## Chart series

Validated with the dataviz palette checker (lightness band, chroma, colour-blind separation, 3:1 contrast on white).

| Token | Hex | Used for |
|---|---|---|
| `chart-1` | `#2F6FDB` | Cash in |
| `chart-2` | `#C9620E` | Cash out, liabilities, expense bars |
| `chart-3` | `#7C5CDB` | Equity |

## Semantic (status)

| Token | Solid | Soft | Line | Meaning |
|---|---|---|---|---|
| `success` | `#1B7A47` | `#ECFDF3` | `#ABEFC6` | Posted, balanced, open period, active, Post button |
| `warning` | `#A15C07` | `#FFFAEB` | `#FEDF89` | Pending approval, rejected drafts, abnormal balance |
| `danger` | `#B42318` | `#FEF3F2` | `#FECDCA` | Reversed, out of balance, errors, destructive actions |
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
| Navigation | Active item · primary red with white text — badges · primary soft |
| Balance checks | Balanced · success — Out of balance · danger |

All text colors meet WCAG AA contrast (4.5:1) on white and on their own soft background.

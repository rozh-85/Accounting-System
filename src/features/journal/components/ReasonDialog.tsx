import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, type ButtonVariant } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Field';

/** Confirmation that requires a written reason, optionally with a date (reversal). */
export function ReasonDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  confirmVariant = 'primary',
  withDate,
  defaultDate,
  minDate,
  loading,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string, date: string) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  withDate?: boolean;
  defaultDate?: string;
  minDate?: string;
  loading?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(defaultDate ?? '');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setDate(defaultDate ?? '');
      setTouched(false);
    }
  }, [open, defaultDate]);

  const reasonError = touched && !reason.trim() ? t('validation.reasonRequired') : null;
  const dateError = touched && withDate && (!date || (minDate && date < minDate)) ? t('errors.REVERSAL_DATE_INVALID') : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant={confirmVariant}
            loading={loading}
            onClick={() => {
              setTouched(true);
              if (!reason.trim() || (withDate && (!date || (minDate && date < minDate)))) return;
              onConfirm(reason.trim(), date);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        {withDate && (
          <Field label={t('journal.reversalDate')} error={dateError} required>
            {(p) => <Input {...p} type="date" className="num" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        )}
        <Field label={t('common.reason')} error={reasonError} required>
          {(p) => <Textarea {...p} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

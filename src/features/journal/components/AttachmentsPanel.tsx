import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime, formatFileSize } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import type { Attachment } from '@/types/database';
import { attachmentUrl, deleteAttachment, uploadAttachment, type AttachmentEntity } from '../api';

export const ACCEPTED_FILES = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.xls,.xlsx,.doc,.docx';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Supporting documents stored in the private Supabase Storage bucket. */
export function AttachmentsPanel({
  entityType,
  entityId,
  attachments,
  editable,
  onChanged,
}: {
  entityType: AttachmentEntity;
  entityId: string;
  attachments: Attachment[];
  editable: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { companyId, can } = useCompany();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const canUpload = editable && can('entries.create');

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) {
          toast.error(t('attachments.tooLarge', { name: file.name }));
          continue;
        }
        await uploadAttachment(companyId, entityType, entityId, file);
      }
      toast.success(t('attachments.uploaded'));
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const open = async (attachment: Attachment, download: boolean) => {
    try {
      const url = await attachmentUrl(attachment.storage_path, download ? attachment.file_name : undefined);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  };

  return (
    <Card>
      <CardHeader
        title={t('attachments.title')}
        description={editable ? t('attachments.hintEditable') : t('attachments.hintLocked')}
        actions={
          canUpload && (
            <>
              <input ref={inputRef} type="file" multiple accept={ACCEPTED_FILES} className="hidden" onChange={(e) => void onFiles(e.target.files)} />
              <Button size="sm" icon={<Upload size={14} />} loading={busy} onClick={() => inputRef.current?.click()}>
                {t('attachments.upload')}
              </Button>
            </>
          )
        }
      />
      {attachments.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted">
          <Paperclip size={15} /> {t('attachments.none')}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
              <FileText size={16} className="shrink-0 text-faint" />
              <button type="button" className="min-w-0 flex-1 truncate text-start text-ink hover:text-accent hover:underline" onClick={() => void open(a, false)}>
                {a.file_name}
              </button>
              <span className="num hidden text-[12px] text-muted sm:inline">{formatFileSize(a.size_bytes)}</span>
              <span className="num hidden text-[12px] text-muted md:inline">{formatDateTime(a.created_at)}</span>
              <IconButton label={t('common.download')} onClick={() => void open(a, true)}>
                <Download size={15} />
              </IconButton>
              {editable && can('entries.edit_draft') && (
                <IconButton
                  label={t('common.delete')}
                  onClick={async () => {
                    try {
                      await deleteAttachment(a.id);
                      onChanged();
                    } catch (e) {
                      toast.error(errorMessage(e, t));
                    }
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** File chooser used before a document exists; files upload right after the first save. */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <div>
        <Button size="sm" icon={<Paperclip size={14} />} onClick={() => inputRef.current?.click()}>
          {t('attachments.choose')}
        </Button>
      </div>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center gap-2 text-ink-soft">
              <FileText size={14} className="text-faint" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="num text-muted">{formatFileSize(file.size)}</span>
              <IconButton label={t('common.remove')} onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-muted">{t('attachments.afterSave')}</p>
    </div>
  );
}

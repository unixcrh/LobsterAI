import React, { useState } from 'react';

import type { CoworkSelectedTextSnippet } from '../../../shared/cowork/selectedText';
import { i18nService } from '../../services/i18n';
import XMarkIcon from '../icons/XMarkIcon';

interface SelectedTextSnippetBadgeProps {
  snippets: CoworkSelectedTextSnippet[];
  onRemove?: (snippetId: string) => void;
  onClear?: () => void;
  onLocate?: (sourceMessageId: string) => void;
}

const SelectedTextSnippetBadge: React.FC<SelectedTextSnippetBadgeProps> = ({
  snippets,
  onRemove,
  onClear,
  onLocate,
}) => {
  const [expanded, setExpanded] = useState(false);
  if (snippets.length === 0) return null;

  return (
    <div className="relative inline-flex max-w-full">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 text-xs text-foreground shadow-subtle transition-colors hover:bg-surface"
      >
        <span aria-hidden="true">▣</span>
        <span>{i18nService.t('coworkSelectedTextSnippetCount').replace('{count}', String(snippets.length))}</span>
      </button>
      {expanded && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-[min(360px,calc(100vw-32px))] rounded-xl border border-border bg-surface p-2 shadow-popover">
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {snippets.map(snippet => (
              <div key={snippet.id} className="flex items-start gap-1 rounded-lg bg-surface-raised px-2 py-1.5 text-xs text-secondary">
                <button
                  type="button"
                  onClick={() => onLocate?.(snippet.sourceMessageId)}
                  disabled={!onLocate}
                  className="min-w-0 flex-1 truncate text-left disabled:cursor-default"
                  title={snippet.text}
                >
                  {snippet.text}
                </button>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(snippet.id)}
                    className="shrink-0 rounded p-0.5 hover:bg-surface"
                    title={i18nService.t('coworkSelectedTextRemove')}
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="mt-2 w-full rounded-lg px-2 py-1 text-left text-xs text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              {i18nService.t('coworkSelectedTextClearAll')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SelectedTextSnippetBadge;

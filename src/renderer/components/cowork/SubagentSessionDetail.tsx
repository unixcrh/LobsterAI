import { ArrowLeftIcon } from '@heroicons/react/20/solid';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { i18nService } from '../../services/i18n';
import type { SubagentSessionSummary } from '../../types/cowork';

interface SubTaskMessage {
  role: string;
  content: string;
}

interface SubagentSessionDetailProps {
  subagent: SubagentSessionSummary;
  onBack: () => void;
}

const SubagentSessionDetail: React.FC<SubagentSessionDetailProps> = ({ subagent, onBack }) => {
  const [messages, setMessages] = useState<SubTaskMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'running' | 'done' | 'error'>(subagent.status);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  const fetchHistory = useCallback(async () => {
    if (!subagent.parentSessionId) return;
    try {
      const result = await window.electron?.cowork?.getSubTaskHistory({
        parentSessionId: subagent.parentSessionId,
        agentId: subagent.id,
        sessionKey: subagent.sessionKey ?? undefined,
      });
      if (result?.success && result.messages) {
        setMessages(result.messages);
      }
    } catch { /* ignore */ }
    finally {
      setLoading(false);
    }
  }, [subagent]);

  const fetchStatus = useCallback(async () => {
    if (!subagent.parentSessionId) return;
    try {
      const result = await window.electron?.cowork?.listSubagentSessions(subagent.parentSessionId);
      if (result?.success && result.runs) {
        const run = result.runs.find((r) => r.id === subagent.id);
        if (run?.status) setStatus(run.status);
      }
    } catch { /* ignore */ }
  }, [subagent]);

  useEffect(() => {
    void fetchHistory();
    void fetchStatus();

    const timer = setInterval(() => {
      void fetchHistory();
      void fetchStatus();
    }, 5000);

    return () => clearInterval(timer);
  }, [fetchHistory, fetchStatus]);

  // Stop polling when done
  useEffect(() => {
    if (status === 'done') {
      void fetchHistory();
    }
  }, [status, fetchHistory]);

  const displayTitle = subagent.task
    ? subagent.task.length > 60 ? subagent.task.slice(0, 60) + '...' : subagent.task
    : subagent.agentId ?? 'Subagent';

  const roleBg = (role: string) =>
    role === 'assistant'
      ? 'bg-blue-50/60 dark:bg-blue-950/20'
      : role === 'tool'
        ? 'bg-amber-50/60 dark:bg-amber-950/20'
        : 'bg-gray-50/60 dark:bg-gray-800/20';

  const roleLabel = (role: string) => {
    if (role === 'user') return i18nService.t('subTaskRoleUser') || 'Task';
    if (role === 'assistant') return subagent.agentId ?? 'Agent';
    if (role === 'tool') return i18nService.t('subTaskRoleTool') || 'Tool';
    return role;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.05]"
          aria-label={i18nService.t('back') || 'Back'}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              status === 'done' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-blue-500 animate-pulse'
            }`}
          />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {displayTitle}
          </span>
        </div>

        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          status === 'done'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : status === 'error'
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        }`}>
          {status === 'done'
            ? (i18nService.t('subagentCompleted') || 'Completed')
            : status === 'error'
              ? (i18nService.t('subagentError') || 'Error')
              : (i18nService.t('subagentWorking') || 'Working...')}
        </span>
      </div>

      {/* Messages */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-secondary">
              {i18nService.t('loading') || 'Loading...'}
            </span>
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-secondary">
              {i18nService.t('subTaskNoHistory') || 'No messages yet'}
            </p>
          </div>
        )}

        {!loading && messages.map((msg, idx) => (
          <div key={idx} className={`rounded-lg px-4 py-3 ${roleBg(msg.role)}`}>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-secondary/70">
              {roleLabel(msg.role)}
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none text-foreground break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
      </div>

      {/* Footer status bar */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2 bg-surface">
        <span className="text-xs text-secondary">
          {messages.length > 0
            ? `${messages.length} ${i18nService.t('subTaskMessages') || 'messages'}`
            : ''}
        </span>
        {subagent.label && (
          <span className="text-xs font-medium text-blue-500/70">
            {subagent.label}
          </span>
        )}
      </div>
    </div>
  );
};

export default SubagentSessionDetail;

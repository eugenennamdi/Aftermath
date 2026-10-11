import React, { useState } from 'react';

export function getActionBadgeStyle(action: string): string {
  switch (action) {
    case 'INCIDENT_RESOLVED':
    case 'FULFILLMENT_SUCCEEDED':
    case 'ENTITLEMENT_PROVISIONED':
    case 'GATE_AUTHORIZED':
    case 'INDEPENDENT_VERIFICATION_SUCCEEDED':
      return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'PAYSTACK_VERIFIED':
      return 'text-teal-700 bg-teal-50 border-teal-200';
    case 'PAYSTACK_FIXTURE_VERIFIED':
      return 'text-amber-800 bg-amber-50 border-amber-200';
    case 'GATE_REJECTED':
    case 'INCIDENT_ESCALATED':
    case 'FULFILLMENT_FAILED':
    case 'SECURITY_MISMATCH':
      return 'text-rose-700 bg-rose-50 border-rose-200';
    case 'RETRY_SCHEDULED':
      return 'text-amber-800 bg-amber-50 border-amber-200';
    case 'INCIDENT_PROCESSING_STARTED':
    case 'WORKER_LEASE_ACQUIRED':
    case 'INVESTIGATION_STARTED':
      return 'text-blue-700 bg-blue-50 border-blue-200';
    default:
      return 'text-foreground bg-muted border-border';
  }
}

/**
 * Renders inline text with bold (**...**) and inline code (`...`) converted to React elements,
 * and highlights key identifiers (ord-*, inc_*, ref-*, cus-*, ent_*).
 */
export function FormattedInline({ text }: { text: string }) {
  if (!text) return null;

  // Tokenize by **bold** or `code`
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(highlightEntities(text.substring(lastIdx, match.index), `txt-${lastIdx}`));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      const inner = token.slice(2, -2);
      parts.push(
        <strong key={`b-${match.index}`} className="font-semibold text-foreground">
          {highlightEntities(inner, `b-in-${match.index}`)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const inner = token.slice(1, -1);
      parts.push(
        <code
          key={`c-${match.index}`}
          className="font-mono bg-muted/80 text-foreground px-1.5 py-0.5 rounded text-[11px]"
        >
          {inner}
        </code>
      );
    }

    lastIdx = regex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(highlightEntities(text.substring(lastIdx), `txt-${lastIdx}`));
  }

  return <>{parts}</>;
}

function highlightEntities(str: string, keyPrefix: string): React.ReactNode {
  // Match identifiers: ord-*, inc_*, ref-*, cus-*, ent_*
  const idRegex = /\b(ord-[a-zA-Z0-9]+|inc_[a-zA-Z0-9]+|ref-[a-zA-Z0-9_-]+|cus-[a-zA-Z0-9]+|ent_[a-zA-Z0-9]+)\b/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = idRegex.exec(str)) !== null) {
    if (match.index > lastIdx) {
      parts.push(str.substring(lastIdx, match.index));
    }
    const id = match[0];
    parts.push(
      <span
        key={`${keyPrefix}-id-${match.index}`}
        className="font-mono bg-muted px-1 py-0.2 rounded text-[11px] text-foreground border border-border/60"
      >
        {id}
      </span>
    );
    lastIdx = idRegex.lastIndex;
  }

  if (lastIdx < str.length) {
    parts.push(str.substring(lastIdx));
  }

  return <React.Fragment key={keyPrefix}>{parts}</React.Fragment>;
}

/**
 * Formats rich structured text from investigator/worker logs.
 * If the text contains "**Findings:**" and/or "**Rationale:**", it breaks it into
 * clean headers, numbered finding cards, and a rationale callout box.
 */
export function FormattedInvestigationText({ text }: { text: string }) {
  if (!text) return null;

  const hasFindings = text.includes('**Findings:**') || text.includes('Findings:');
  const hasRationale = text.includes('**Rationale:**') || text.includes('Rationale:');

  if (!hasFindings && !hasRationale) {
    let paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 1 && text.length > 250) {
      const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [text];
      if (sentences.length >= 4) {
        const p1 = sentences.slice(0, 2).join('').trim();
        const p2 = sentences.slice(2, sentences.length - 1).join('').trim();
        const p3 = sentences.slice(sentences.length - 1).join('').trim();
        paragraphs = [p1, p2, p3].filter((p) => p.length > 0);
      }
    }

    if (paragraphs.length > 1) {
      return (
        <div className="space-y-2 text-xs leading-relaxed text-foreground/90 font-sans">
          {paragraphs.map((para, i) => (
            <p key={i}>
              <FormattedInline text={para} />
            </p>
          ))}
        </div>
      );
    }
    return (
      <p className="text-xs leading-relaxed text-foreground/90 font-sans">
        <FormattedInline text={text} />
      </p>
    );
  }

  // Parse structured findings & rationale
  let prefix = '';
  let findingsText = '';
  let rationaleText = '';

  const findingsSplit = text.split(/\*\*Findings:\*\*|Findings:/);
  prefix = findingsSplit[0]?.trim() || '';

  const afterFindings = findingsSplit[1] || '';
  if (hasRationale) {
    const rationaleSplit = afterFindings.split(/\*\*Rationale:\*\*|Rationale:/);
    findingsText = rationaleSplit[0]?.trim() || '';
    rationaleText = rationaleSplit[1]?.trim() || '';
  } else {
    findingsText = afterFindings.trim();
  }

  // Extract lead title and metadata from prefix (e.g., "Retry #1 scheduled: **Incident:** ... | **Order:** ...")
  let leadTitle = prefix;
  let prefixChips: Array<{ label: string; value: string }> = [];

  if (prefix.includes('**Incident:**') || prefix.includes('|')) {
    const parts = prefix.split(/(?=\*\*Incident:\*\*|\*\*Order:\*\*|\*\*Ref:\*\*)/);
    leadTitle = parts[0]?.replace(/:$/, '').trim() || prefix;

    const chipMatches = prefix.matchAll(/\*\*(Incident|Order|Ref):\*\*\s*([^\s|*]+)/g);
    for (const m of chipMatches) {
      prefixChips.push({ label: m[1], value: m[2] });
    }
  }

  // Split individual numbered findings: e.g. "1. **Order (Trusted Source):** Valid..."
  const findingItems: Array<{ num: string; title: string; body: string }> = [];
  if (findingsText) {
    // Match each numbered item: "1. **Title:** Body..."
    const itemRegex = /(?:^|\s)(\d+)\.\s*(?:\*\*(.*?)\*\*[:\-]?\s*)?(.*?)(?=(?:\s\d+\.\s)|$)/gs;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(findingsText)) !== null) {
      const num = m[1];
      const title = m[2]?.replace(/:$/, '').trim() || `Finding ${num}`;
      const body = m[3]?.trim() || '';
      if (body || title) {
        findingItems.push({ num, title, body });
      }
    }
  }

  return (
    <div className="space-y-3 font-sans text-xs">
      {/* Lead title and context chips */}
      {leadTitle && (
        <div className="space-y-1.5">
          <div className="font-semibold text-foreground text-xs leading-snug">
            <FormattedInline text={leadTitle} />
          </div>
          {prefixChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {prefixChips.map((chip, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border"
                >
                  <span className="text-foreground/70 font-medium">{chip.label}:</span>
                  <span className="text-foreground font-mono">{chip.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Numbered Findings Cards */}
      {findingItems.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Investigator Findings ({findingItems.length})
          </div>
          <div className="grid grid-cols-1 gap-2">
            {findingItems.map((item, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-lg bg-muted/40 border border-border/80 flex items-start gap-2.5"
              >
                <span className="w-5 h-5 rounded-full bg-muted border border-border text-[11px] font-mono font-bold text-foreground flex items-center justify-center shrink-0 mt-0.5">
                  {item.num}
                </span>
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="font-semibold text-foreground text-[11px]">
                    <FormattedInline text={item.title} />
                  </div>
                  <div className="text-muted-foreground leading-relaxed text-[11px]">
                    <FormattedInline text={item.body} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rationale Callout Box */}
      {rationaleText && (
        <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200/70 text-amber-900 space-y-1">
          <div className="font-semibold text-[11px] uppercase tracking-wider text-amber-800">
            Decision Rationale
          </div>
          <p className="text-[11px] leading-relaxed text-amber-900/90 font-sans">
            <FormattedInline text={rationaleText} />
          </p>
        </div>
      )}
    </div>
  );
}

export interface ParsedAuditDetails {
  summary: string | null;
  metadata: Array<{ label: string; value: string }>;
  rawJson: unknown | null;
  rawString: string | null;
  isStructuredInvestigation: boolean;
}

export function parseAuditDetails(raw: string | null): ParsedAuditDetails {
  if (!raw) {
    return {
      summary: 'No details recorded',
      metadata: [],
      rawJson: null,
      rawString: null,
      isStructuredInvestigation: false,
    };
  }

  // Check if string contains rich investigator findings
  const isStructured = raw.includes('**Findings:**') || raw.includes('**Rationale:**');

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      let summary =
        parsed.message ||
        parsed.reason ||
        parsed.summary ||
        parsed.decisionSummary ||
        parsed.error ||
        null;

      // Friendly default summaries if missing
      if (!summary && parsed.workerId && parsed.fencingToken) {
        summary = `Worker acquired lease with monotonic fencing token #${parsed.fencingToken}`;
      } else if (!summary && parsed.reference && parsed.provenance) {
        const outcome = parsed.outcome ? ` (${String(parsed.outcome).toUpperCase()})` : '';
        summary = `Payment verified via ${parsed.provenance}${outcome}`;
      }

      const metadata: Array<{ label: string; value: string }> = [];

      for (const [key, value] of Object.entries(parsed)) {
        if (['message', 'reason', 'summary', 'decisionSummary', 'error'].includes(key)) {
          continue;
        }
        if (value === null || value === undefined) continue;

        let label = key;
        if (key === 'workerId') label = 'Worker';
        else if (key === 'fencingToken') label = 'Fencing Token';
        else if (key === 'executionMode') label = 'Execution Mode';
        else if (key === 'provenance') label = 'Provenance';
        else if (key === 'reference') label = 'Payment Ref';
        else if (key === 'outcome') label = 'Outcome';
        else if (key === 'amount') label = 'Amount';
        else if (key === 'currency') label = 'Currency';
        else if (key === 'customerEmail') label = 'Customer';
        else if (key === 'gatewayResponse') label = 'Gateway Response';
        else if (key === 'verifiedAt') label = 'Verified At';

        let formattedValue = String(value);
        if (key === 'fencingToken') {
          formattedValue = `#${value}`;
        } else if (key === 'amount' && typeof value === 'number') {
          formattedValue = `${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} NGN`;
        }

        metadata.push({ label, value: formattedValue });
      }

      return {
        summary,
        metadata,
        rawJson: parsed,
        rawString: raw,
        isStructuredInvestigation: false,
      };
    }
  } catch {
    // Plain text string (not JSON)
  }

  // Parse key=value strings if present (e.g. "Incident opened: reason=PAID_BUT_UNFULFILLED, details=SIMULATED...")
  const metadata: Array<{ label: string; value: string }> = [];
  let summary = raw;

  if (raw.startsWith('Incident opened:')) {
    const reasonMatch = raw.match(/reason=([^\s,]+)/);
    const detailsMatch = raw.match(/details=(.+)$/);
    if (reasonMatch) {
      metadata.push({ label: 'Reason', value: reasonMatch[1] });
      summary = 'Incident opened for unfulfilled checkout';
    }
    if (detailsMatch) {
      summary = detailsMatch[1];
    }
  }

  return {
    summary,
    metadata,
    rawJson: null,
    rawString: raw,
    isStructuredInvestigation: isStructured,
  };
}

export function AuditLogEntryCard({
  log,
  compact = false,
}: {
  log: {
    id: string;
    action: string;
    actor: string;
    details: string | null;
    createdAt: Date | string;
    orderId?: string | null;
    incidentId?: string | null;
  };
  compact?: boolean;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const parsed = parseAuditDetails(log.details);

  const metadata = [...parsed.metadata];
  if (log.orderId && !metadata.some((m) => m.label.toLowerCase().includes('order'))) {
    metadata.unshift({ label: 'Order', value: log.orderId });
  }
  if (log.incidentId && !metadata.some((m) => m.label.toLowerCase().includes('incident'))) {
    metadata.unshift({ label: 'Incident', value: log.incidentId });
  }

  return (
    <div
      className={`rounded-xl border border-border bg-card/70 hover:bg-muted/20 transition-colors ${
        compact ? 'p-3 space-y-2' : 'p-3.5 sm:p-4 space-y-2.5'
      }`}
    >
      {/* Header: Action Badge, Actor, Tabular Timestamp */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded border ${getActionBadgeStyle(
              log.action
            )}`}
          >
            {log.action}
          </span>
          <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
            {log.actor}
          </span>
        </div>
        <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {new Date(log.createdAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </div>
      </div>

      {/* Main Content Area */}
      {parsed.isStructuredInvestigation && log.details ? (
        <FormattedInvestigationText text={log.details} />
      ) : parsed.summary ? (
        <div className="text-xs text-foreground/90 leading-relaxed font-sans">
          <FormattedInline text={parsed.summary} />
        </div>
      ) : null}

      {/* Metadata Chips (Worker, Fencing, Ref, etc.) */}
      {metadata.length > 0 && !parsed.isStructuredInvestigation && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {metadata.map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/80"
            >
              <span className="text-foreground/70 font-medium">{item.label}:</span>
              <span className="text-foreground font-mono">{item.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Expandable Raw Payload Toggle */}
      {(Boolean(parsed.rawJson) || (log.details && log.details.length > 80)) && (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors cursor-pointer"
          >
            {showRaw ? 'Hide Raw Details' : 'View Raw Details'}
          </button>
          {showRaw && (
            <pre className="mt-2 p-2.5 rounded-lg bg-muted text-[10px] font-mono text-foreground/80 overflow-x-auto border border-border whitespace-pre-wrap">
              {parsed.rawJson ? JSON.stringify(parsed.rawJson, null, 2) : log.details}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

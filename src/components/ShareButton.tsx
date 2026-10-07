import { useEffect, useRef, useState } from 'react';

/** Copies a link to the current view. Falls back to showing the link when copying is blocked. */
export default function ShareButton() {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status !== 'copied') return;
    const t = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (status === 'manual') inputRef.current?.select();
  }, [status]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  };

  return (
    <div className="share">
      <button type="button" className="share-btn" onClick={share} aria-live="polite">
        {status === 'copied' ? 'Link copied' : 'Share'}
      </button>
      {status === 'manual' && (
        <div className="share-popover">
          <label htmlFor="share-link">Copy this link</label>
          <input
            ref={inputRef}
            id="share-link"
            readOnly
            value={window.location.href}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setStatus('idle')}
          />
        </div>
      )}
    </div>
  );
}

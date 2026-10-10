'use client';

import React, { useState } from 'react';
import { DoubleBezelCard } from './ui/card';
import { Button } from './ui/button';
import { LockIcon, UnlockIcon, XIcon, ShieldIcon } from './ui/icons';

interface OperatorLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function OperatorLoginModal({
  isOpen,
  onClose,
  onSuccess,
}: OperatorLoginModalProps) {
  const [secret, setSecret] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/operator/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      setSecret('');
      onSuccess();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md">
        <DoubleBezelCard>
          <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300">
                <LockIcon size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Operator Console Unlock</h3>
                <p className="text-[11px] text-zinc-400">Restricted to authorized engineers</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md transition-colors"
            >
              <XIcon size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Operator Security Key
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Enter operator passphrase..."
                autoFocus
                className="w-full px-3.5 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors"
              />
              <p className="text-[11px] text-zinc-500">
                Authorizes live execution of acceptance scenarios and manual worker sweeps.
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs">
                {error}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isLoading}
                icon={<UnlockIcon size={14} />}
              >
                Unlock Operator Session
              </Button>
            </div>
          </form>
        </DoubleBezelCard>
      </div>
    </div>
  );
}

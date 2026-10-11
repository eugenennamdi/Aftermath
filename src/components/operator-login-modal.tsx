'use client';

import React, { useState } from 'react';
import { Button } from './ui/button';
import { LockIcon, UnlockIcon, XIcon } from './ui/icons';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-2xl p-6">
          <div className="flex items-center justify-between pb-4 border-b border-[#E5E7EB]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#44647B]/10 border border-[#44647B]/20 flex items-center justify-center text-[#44647B]">
                <LockIcon size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#171B23]">Operator Console Unlock</h3>
                <p className="text-[11px] text-[#69717C]">Restricted to authorized engineers</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[#9CA3AF] hover:text-[#171B23] p-1 rounded-md transition-colors cursor-pointer"
            >
              <XIcon size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#374151]">
                Operator Security Key
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Enter operator passphrase..."
                autoFocus
                className="w-full px-3.5 py-2 text-xs font-mono bg-white border border-[#E5E7EB] rounded-lg text-[#171B23] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#44647B] focus:ring-1 focus:ring-[#44647B] transition-colors shadow-xs"
              />
              <p className="text-[11px] text-[#69717C]">
                Authorizes live execution of acceptance scenarios and manual worker sweeps.
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
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
        </div>
      </div>
    </div>
  );
}

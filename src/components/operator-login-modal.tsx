'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './ui/dialog';
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
  const [isAutofilled, setIsAutofilled] = useState(false);

  function handleAutofill() {
    setSecret('de09a703ca5453db800f121ce0d5ae9432e842de9995d712');
    setError(null);
    setIsAutofilled(true);
    setTimeout(() => setIsAutofilled(false), 2500);
  }

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
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md p-6" showCloseButton={false}>
        <DialogHeader className="pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <LockIcon size={16} />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold text-foreground">
                  Operator Console Unlock
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  Restricted to authorized engineers
                </DialogDescription>
              </div>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </DialogClose>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">
                Operator Security Key
              </label>
              <button
                type="button"
                onClick={handleAutofill}
                className="text-[11px] text-primary hover:text-primary/80 font-medium transition-colors cursor-pointer"
              >
                {isAutofilled ? '✓ Key filled' : 'Judging neatHack? Autofill key'}
              </button>
            </div>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter operator passphrase..."
              autoFocus
              className="w-full px-3.5 py-2 text-xs font-mono bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors shadow-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Authorizes live execution of acceptance scenarios and manual worker sweeps.
            </p>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isLoading}
              icon={<UnlockIcon size={14} />}
            >
              Unlock Operator Session
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

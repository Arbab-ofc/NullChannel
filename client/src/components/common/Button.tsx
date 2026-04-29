import type { ButtonHTMLAttributes } from 'react';

export const Button = ({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={`rounded-md border border-violet-500/60 bg-panel px-4 py-2 text-sm font-medium text-text transition hover:border-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 ${className}`}
    {...props}
  />
);

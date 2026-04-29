import type { ButtonHTMLAttributes } from 'react';

export const Button = ({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={`neo-action rounded-none border-2 border-accent bg-panel px-4 py-2 text-sm font-semibold uppercase tracking-wider text-text shadow-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 disabled:shadow-none disabled:transform-none ${className}`}
    {...props}
  />
);

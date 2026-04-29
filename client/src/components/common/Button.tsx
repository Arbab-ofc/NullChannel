import type { ButtonHTMLAttributes } from 'react';

export const Button = ({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={`rounded-none border-2 border-accent bg-panel px-4 py-2 text-sm font-semibold uppercase tracking-wider text-text shadow-panel transition duration-150 hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-punch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 ${className}`}
    {...props}
  />
);

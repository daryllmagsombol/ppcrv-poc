'use client';

import { SelectHTMLAttributes } from 'react';

interface Option {
  value: string;
  label: string;
}

interface CascadingDropdownProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: Option[];
  loading?: boolean;
  placeholder?: string;
}

export function CascadingDropdown({
  label,
  options,
  loading = false,
  placeholder = `Select ${label}`,
  disabled,
  ...selectProps
}: CascadingDropdownProps) {
  return (
    <div className="flex items-center gap-4 py-2">
      <label className="w-36 text-sm font-semibold uppercase tracking-wide text-[#1B3A5C]">
        {label}:
      </label>
      <select
        className="flex-1 rounded border border-gray-300 bg-[#F8F6F0] px-3 py-2 font-mono text-sm text-[#1B3A5C] disabled:opacity-50"
        disabled={disabled || loading}
        {...selectProps}
      >
        <option value="">
          {loading ? 'Loading...' : placeholder}
        </option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

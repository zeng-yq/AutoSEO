import { useState } from 'react';
export default function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={{
        width: '100%', height: 32, padding: '0 10px',
        background: 'var(--color-canvas)', color: 'var(--color-ink)',
        border: `1px solid ${focused ? 'var(--color-primary)' : 'var(--color-hairline)'}`,
        borderRadius: 'var(--radius-md)', fontSize: 13, outline: 'none',
        ...props.style,
      }}
    />
  );
}

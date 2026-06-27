interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}
const styles: Record<string, React.CSSProperties> = {
  primary: { background: 'var(--color-primary)', color: 'var(--color-on-primary)', border: 'none' },
  secondary: { background: 'var(--color-canvas)', color: 'var(--color-ink)', border: '1px solid var(--color-hairline)' },
};
export default function Button({ variant = 'primary', style, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      style={{
        height: 32, padding: '0 16px', borderRadius: 'var(--radius-md)',
        fontSize: 13, fontWeight: 500, lineHeight: 1, ...styles[variant], ...style,
      }}
    />
  );
}

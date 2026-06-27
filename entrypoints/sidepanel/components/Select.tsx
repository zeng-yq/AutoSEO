interface Option { value: string; label: string; }
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: Option[];
}
export default function Select({ options, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      style={{
        width: '100%', height: 32, padding: '0 8px',
        background: 'var(--color-canvas)', color: 'var(--color-ink)',
        border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
        fontSize: 13, ...rest.style,
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

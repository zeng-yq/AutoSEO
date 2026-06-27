export default function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        width: '100%', padding: '8px 10px', resize: 'vertical',
        background: 'var(--color-canvas)', color: 'var(--color-ink)',
        border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
        fontSize: 13, lineHeight: 1.5, fontFamily: 'var(--font-mono)', ...props.style,
      }}
    />
  );
}

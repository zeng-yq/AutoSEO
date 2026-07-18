import { useState } from 'react';

export interface ComboboxProps {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onManage?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  /** 输入时实时清洗(如剥掉协议头/路径仅保留域名);返回值同时回写 input 与 onChange。 */
  sanitize?: (value: string) => string;
}

export default function Combobox({ value, options, onChange, onManage, onBlur, placeholder, sanitize }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  // 内部 query 状态用于过滤建议；外部受控 value 仍用于回填输入框。
  // 这样即便父组件暂时未回写 value，输入当下的文本也能立即过滤下拉项。
  const [query, setQuery] = useState(value);
  const filterText = query.trim();
  const suggestions = filterText
    ? options.filter((o) => o.toLowerCase().includes(filterText.toLowerCase())).slice(0, 8)
    : options.slice(0, 8);
  // 下拉建议显示条件：仅由 open 控制（聚焦/输入时为 true，onBlur 后为 false）。
  const showSuggestions = open && suggestions.length > 0;

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => { const v = sanitize ? sanitize(e.target.value) : e.target.value; onChange(v); setQuery(v); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { onBlur?.(); setTimeout(() => setOpen(false), 120); }}
          style={{
            width: '100%', height: 32, padding: '0 10px',
            background: 'var(--color-canvas)', color: 'var(--color-ink)',
            border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
            fontSize: 13, outline: 'none', fontFamily: 'var(--font-mono)',
          }}
        />
        {showSuggestions && (
          <div style={{
            position: 'absolute', top: 34, left: 0, right: 0, zIndex: 10,
            background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)',
            borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(20,20,19,0.08)', overflow: 'hidden',
          }}>
            {suggestions.map((o) => (
              <button
                key={o}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(o); setQuery(o); setOpen(false); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 10px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--color-ink)', cursor: 'pointer' }}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
      {onManage && (
        <button type="button" onClick={onManage} style={{
          flexShrink: 0, height: 32, padding: '0 10px', whiteSpace: 'nowrap',
          background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
          color: 'var(--color-ink)', cursor: 'pointer', fontSize: 12,
        }}>
          网站管理
        </button>
      )}
    </div>
  );
}

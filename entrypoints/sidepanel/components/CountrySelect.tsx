import { useEffect, useMemo, useState } from 'react';

export interface CountryOption {
  value: string; // 存储值（国家 code 或 'OFF'）
  label: string; // 显示名
  flag?: string; // emoji 国旗
  searchKeys?: string[]; // 搜索关键词（中文 / 英文 / code），缺省时用 [label, value]
}

interface CountrySelectProps {
  value: string;
  options: CountryOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** true=允许输入列表外的自由文本（Ahrefs 任意两位代码）；false=仅限列表内（QuickSearch）。 */
  allowFreeText?: boolean;
  /** 自由文本合法性校验（Ahrefs 传 isValidCountryCode）。 */
  freeTextValidate?: (v: string) => boolean;
  /** 置顶的固定项（QuickSearch 的「关闭」）。 */
  prefixOptions?: CountryOption[];
  ariaLabel?: string;
  style?: React.CSSProperties;
}

function display(o: CountryOption): string {
  return o.flag ? `${o.flag} ${o.label}` : o.label;
}

function matchOption(o: CountryOption, q: string): boolean {
  const keys = o.searchKeys ?? [o.label, o.value];
  return keys.some((k) => k.toLowerCase().includes(q));
}

/**
 * 可搜索的国家选择器。视觉与 Select / Combobox 对齐（复用 tokens）。
 * - 非编辑态：输入框回显当前选中项「flag 中文名」。
 * - 聚焦：全选文本，输入即按 searchKeys 模糊过滤下拉。
 * - 失焦/回车：唯一匹配自动选中；否则按 allowFreeText 决定提交自由文本或回退原值。
 */
export default function CountrySelect({
  value, options, onChange, placeholder,
  allowFreeText = false, freeTextValidate, prefixOptions, ariaLabel, style,
}: CountrySelectProps) {
  const allOptions = useMemo(() => [...(prefixOptions ?? []), ...options], [prefixOptions, options]);

  const [text, setText] = useState(() => {
    const sel = allOptions.find((o) => o.value === value);
    return sel ? display(sel) : '';
  });
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);

  // 外部 value 变化且非编辑态 → 同步回显（QuickSearch 启动时从 storage 读回偏好）。
  useEffect(() => {
    if (editing) return;
    const sel = allOptions.find((o) => o.value === value);
    setText(sel ? display(sel) : (allowFreeText ? value : ''));
  }, [value, editing, allowFreeText, allOptions]);

  const q = text.trim().toLowerCase();
  const suggestions = q ? allOptions.filter((o) => matchOption(o, q)) : allOptions;
  const showList = open && suggestions.length > 0;

  function pick(o: CountryOption) {
    onChange(o.value);
    setText(display(o));
    setEditing(false);
    setOpen(false);
  }

  /** 失焦/回车（无建议时）的提交逻辑。 */
  function commit() {
    setOpen(false);
    const trimmed = text.trim();
    const ql = trimmed.toLowerCase();
    const filtered = ql ? allOptions.filter((o) => matchOption(o, ql)) : [];
    if (filtered.length === 1) { pick(filtered[0]); return; } // 唯一匹配自动选中
    const hit = allOptions.find((o) => display(o) === trimmed || o.value.toLowerCase() === ql);
    if (hit) { pick(hit); return; }
    if (allowFreeText && freeTextValidate?.(trimmed)) {
      onChange(trimmed);
      setText(trimmed);
      setEditing(false);
      return;
    }
    // 回退到当前 value
    const sel = allOptions.find((o) => o.value === value);
    setText(sel ? display(sel) : '');
    setEditing(false);
  }

  function onFocus(e: React.FocusEvent<HTMLInputElement>) {
    setOpen(true);
    setEditing(true);
    e.currentTarget.select();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0) pick(suggestions[0]);
      else commit();
    } else if (e.key === 'Escape') {
      setOpen(false);
      const sel = allOptions.find((o) => o.value === value);
      setText(sel ? display(sel) : '');
      setEditing(false);
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', minWidth: 0, ...style }}>
      <input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={onFocus}
        onBlur={commit}
        onKeyDown={onKeyDown}
        style={{
          width: '100%', height: 32, padding: '0 28px 0 10px',
          background: 'var(--color-canvas)', color: 'var(--color-ink)',
          border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
          fontSize: 13, outline: 'none',
        }}
      />
      {/* 下拉箭头:纯视觉提示,点击穿透到 input 触发聚焦展开 */}
      <span aria-hidden="true" style={{
        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
        pointerEvents: 'none', color: 'var(--color-muted)', fontSize: 10, lineHeight: 1,
      }}>▾</span>
      {showList && (
        <div style={{
          position: 'absolute', top: 34, left: 0, right: 0, zIndex: 10,
          maxHeight: 240, overflowY: 'auto',
          background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)',
          borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(20,20,19,0.08)',
        }}>
          {suggestions.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none',
                  background: active ? 'var(--color-surface-soft)' : 'transparent',
                  padding: '6px 10px', fontSize: 12, color: 'var(--color-ink)', cursor: 'pointer',
                }}
              >
                {display(o)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

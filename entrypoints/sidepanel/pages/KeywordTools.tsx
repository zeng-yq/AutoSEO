import { useEffect, useState } from 'react';
import TextInput from '../components/TextInput';
import AhrefsTool from './AhrefsTool';
import GoogleTrendsTool from './GoogleTrendsTool';
import QuickSearchTool from './QuickSearchTool';

const STORAGE_KEY = 'kw-tools:keyword';

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 };

export default function KeywordTools() {
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (items) => {
      const kw = items[STORAGE_KEY] as string | undefined;
      if (kw) setKeyword(kw);
    });
  }, []);

  function onChange(value: string) {
    setKeyword(value);
    chrome.storage.local.set({ [STORAGE_KEY]: value });
  }

  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <label style={labelStyle}>关键词</label>
      <TextInput value={keyword} placeholder="如 apple" onChange={(e) => onChange(e.target.value)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
        <AhrefsTool keyword={keyword} />
        <GoogleTrendsTool keyword={keyword} />
        <QuickSearchTool keyword={keyword} />
      </div>
    </div>
  );
}

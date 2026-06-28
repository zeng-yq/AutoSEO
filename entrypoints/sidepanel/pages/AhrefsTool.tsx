import { useEffect, useState } from 'react';
import Button from '../components/Button';
import TextInput from '../components/TextInput';
import Select from '../components/Select';
import { COUNTRIES, buildAhrefsUrl, isValidCountryCode } from '@lib/ahrefs/url';

const STORAGE_KEY = 'ahrefs:last';
interface Last { country: string; keyword: string; }

export default function AhrefsTool() {
  const [country, setCountry] = useState('us');
  const [keyword, setKeyword] = useState('');
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (items) => {
      const last = items[STORAGE_KEY] as Last | undefined;
      if (last) { setCountry(last.country); setKeyword(last.keyword); }
    });
  }, []);

  const options = [...COUNTRIES.map((c) => ({ value: c.code, label: c.label })), { value: '__custom', label: '自定义…' }];

  function open() {
    try {
      const cc = country;
      const url = buildAhrefsUrl(cc, keyword);
      chrome.storage.local.set({ [STORAGE_KEY]: { country: cc, keyword } });
      chrome.tabs.create({ url });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>国家</label>
      <Select value={country} options={options} onChange={(e) => {
        if (e.target.value === '__custom') { setCustom(true); setCountry(''); }
        else { setCustom(false); setCountry(e.target.value); }
      }} />
      {custom && (
        <TextInput value={country} placeholder="两位代码，如 us" onChange={(e) => setCountry(e.target.value)} style={{ marginTop: 8 }} />
      )}

      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', margin: 'var(--space-sm) 0 4px' }}>关键词</label>
      <TextInput value={keyword} placeholder="如 apple" onChange={(e) => setKeyword(e.target.value)} />

      {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 6 }}>{error}</div>}

      <Button onClick={open} disabled={!keyword.trim() || !isValidCountryCode(country)} style={{ marginTop: 'var(--space-md)', width: '100%' }}>
        打开查询
      </Button>
    </div>
  );
}

import { useEffect, useState } from 'react';
import Button from '../components/Button';
import TextInput from '../components/TextInput';
import Select from '../components/Select';
import ToolPanel from '../components/ToolPanel';
import { AhrefsLogo } from '../components/brand-logos';
import { COUNTRIES, buildAhrefsUrl, isValidCountryCode } from '@lib/ahrefs/url';

const STORAGE_KEY = 'ahrefs:last';
interface Last { country: string; }
interface Props { keyword: string; }

export default function AhrefsTool({ keyword }: Props) {
  const [country, setCountry] = useState('us');
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (items) => {
      const last = items[STORAGE_KEY] as Last | undefined;
      if (last?.country) setCountry(last.country);
    });
  }, []);

  const options = [...COUNTRIES.map((c) => ({ value: c.code, label: c.label })), { value: '__custom', label: '自定义…' }];

  function open() {
    try {
      const url = buildAhrefsUrl(country, keyword);
      chrome.storage.local.set({ [STORAGE_KEY]: { country } });
      chrome.tabs.create({ url });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const canOpen = !keyword.trim() || !isValidCountryCode(country);

  return (
    <ToolPanel
      logo={<AhrefsLogo size={18} />}
      title="Keyword Difficulty Checker"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
        <Select
          value={country}
          options={options}
          onChange={(e) => {
            if (e.target.value === '__custom') { setCustom(true); setCountry(''); }
            else { setCustom(false); setCountry(e.target.value); }
          }}
          style={{ flex: 1, width: 'auto' }}
        />
        <Button onClick={open} disabled={canOpen} style={{ flexShrink: 0 }}>查询</Button>
      </div>
      {custom && (
        <TextInput
          value={country}
          placeholder="两位代码,如 us"
          onChange={(e) => setCountry(e.target.value)}
          style={{ marginTop: 8 }}
        />
      )}
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </ToolPanel>
  );
}

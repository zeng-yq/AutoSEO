import { useEffect, useState } from 'react';
import Button from './Button';
import { useGscCredentials } from '../hooks/useGscCredentials';

/**
 * GSC 服务账号密钥配置区（常驻提交面板，对应 IndexNowKeySection）。
 * textarea 粘贴整段服务账号 JSON；保存/清空/测试连接。
 * 测试连接：强制重换 access_token，验证密钥格式 + private_key 有效（不验证站点所有权，由真实提交的 403 暴露）。
 */
export default function GscCredentialsSection() {
  const { credentials, save, clear, testConnection, testStatus, testMessage } = useGscCredentials();
  const [draft, setDraft] = useState(credentials ?? '');

  // credentials 外部变化（如 save/clear 后 storage.onChanged 回写）时同步 draft
  useEffect(() => { setDraft(credentials ?? ''); }, [credentials]);

  const dirty = draft !== (credentials ?? '');
  const testColor = testStatus === 'ok' ? '#16a34a'
    : testStatus === 'fail' ? '#dc2626'
    : 'var(--color-muted)';

  return (
    <div style={{ marginTop: 'var(--space-md)', padding: 12, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)' }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 6 }}>GSC 服务账号密钥（Indexing API）</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={credentials ? '已配置密钥（粘贴新内容覆盖）' : '粘贴从 Google Cloud 下载的服务账号 JSON 文件内容'}
        aria-label="GSC 服务账号 JSON"
        rows={4}
        style={{
          width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 8,
          borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)',
          background: 'var(--color-canvas)', color: 'var(--color-ink)',
          resize: 'vertical', boxSizing: 'border-box', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => save(draft)} disabled={!dirty}>保存</Button>
        <Button variant="secondary" onClick={() => void testConnection()} disabled={!credentials || testStatus === 'testing'}>
          {testStatus === 'testing' ? '测试中…' : '测试连接'}
        </Button>
        {credentials && <Button variant="secondary" onClick={clear}>清空</Button>}
      </div>
      {testMessage && <div style={{ fontSize: 11, color: testColor, marginTop: 8 }}>{testMessage}</div>}
      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8 }}>
        配置：① Google Cloud 建服务账号下载 JSON → ② 把 client_email 加为 Search Console 站点所有者 → ③ 粘贴 JSON 到上方。
      </div>
    </div>
  );
}

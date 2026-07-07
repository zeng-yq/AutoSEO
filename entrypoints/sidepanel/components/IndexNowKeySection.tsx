import Button from './Button';
import TextInput from './TextInput';
import { useIndexNowKey } from '../hooks/useIndexNowKey';
import { isValidDomain } from '@lib/storage/projects';

/**
 * IndexNow 密钥配置表单（嵌入 CredentialsSection 的 Tab 内）。
 * 未配置：显示「生成密钥」。
 * 已配置：readonly 输入框展示 key + 「下载密钥文件」「刷新」「测试连接」。
 * 测试连接：GET <domain>/<key>.txt 验证密钥文件是否正确部署到当前选中站点根目录。
 * 文案提示用户把 <key>.txt 上传到每个站点根目录。
 */
export default function IndexNowKeySection({ domain }: { domain: string }) {
  const { key, generate, refresh, download, testConnection, testStatus, testMessage } = useIndexNowKey();
  const fileName = key ? `${key}.txt` : '<key>.txt';
  const urlExample = 'https://<你的域名>/<key>.txt';
  const domainOk = isValidDomain(domain);
  const testColor = testStatus === 'ok' ? 'var(--color-success)'
    : testStatus === 'fail' ? 'var(--color-error)'
    : 'var(--color-muted)';

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 6 }}>密钥将提交到 Bing / Yandex 等搜索引擎</div>
      <TextInput
        value={key ?? ''}
        readOnly
        placeholder="未生成"
        aria-label="IndexNow 密钥"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {!key && <Button onClick={generate}>生成密钥</Button>}
        {key && <Button onClick={download}>下载密钥文件</Button>}
        {key && <Button variant="secondary" onClick={refresh}>刷新</Button>}
        {key && (
          <Button
            variant="secondary"
            onClick={() => testConnection(domain)}
            disabled={!domainOk || testStatus === 'testing'}
          >
            {testStatus === 'testing' ? '测试中…' : '测试连接'}
          </Button>
        )}
      </div>
      {key && !domainOk && (
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8 }}>请先在上方选择有效站点</div>
      )}
      {testMessage && <div style={{ fontSize: 11, color: testColor, marginTop: 8 }}>{testMessage}</div>}
      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8 }}>
        请将 <span style={{ fontFamily: 'var(--font-mono)' }}>{fileName}</span> 上传到你【每个】站点的根目录：
        <span style={{ fontFamily: 'var(--font-mono)' }}>{urlExample}</span>
      </div>
    </div>
  );
}

import Button from './Button';
import TextInput from './TextInput';
import { useIndexNowKey } from '../hooks/useIndexNowKey';

/**
 * IndexNow 密钥配置区（常驻提交面板）。
 * 未配置：显示「生成密钥」。
 * 已配置：readonly 输入框展示 key + 「下载密钥文件」「刷新」。
 * 文案提示用户把 <key>.txt 上传到每个站点根目录。
 */
export default function IndexNowKeySection() {
  const { key, generate, refresh, download } = useIndexNowKey();
  const fileName = key ? `${key}.txt` : '<key>.txt';
  const urlExample = 'https://<你的域名>/<key>.txt';
  return (
    <div style={{ marginTop: 'var(--space-md)', padding: 12, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)' }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 6 }}>IndexNow 密钥（提交到 Bing/Yandex 等搜索引擎）</div>
      <TextInput
        value={key ?? ''}
        readOnly
        placeholder="未生成"
        aria-label="IndexNow 密钥"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {!key && <Button onClick={generate}>生成密钥</Button>}
        {key && <Button onClick={download}>下载密钥文件</Button>}
        {key && <Button variant="secondary" onClick={refresh}>刷新</Button>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8 }}>
        请将 <span style={{ fontFamily: 'var(--font-mono)' }}>{fileName}</span> 上传到你【每个】站点的根目录：
        <span style={{ fontFamily: 'var(--font-mono)' }}>{urlExample}</span>
      </div>
    </div>
  );
}

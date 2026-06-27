export interface Settings { accountIndex: number; }
const KEY = 'settings';
const DEFAULT: Settings = { accountIndex: 0 };

export async function getSettings(): Promise<Settings> {
  const items = await chrome.storage.local.get(KEY);
  return { ...DEFAULT, ...(items[KEY] as Partial<Settings> | undefined) };
}
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings();
  await chrome.storage.local.set({ [KEY]: { ...cur, ...patch } });
}

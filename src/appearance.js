export const THEME_KEY = 'moi-kvartiry:theme:v1';
export const THEMES = [
  { id: 'white', label: 'Белая', color: '#ffffff' },
  { id: 'light', label: 'Светлая', color: '#eef0f3' },
  { id: 'dark', label: 'Тёмная', color: '#10141b' },
];

export function currentTheme() {
  return THEMES.some(t => t.id === document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'light';
}

export function setTheme(id, persist = true) {
  const theme = THEMES.find(t => t.id === id) || THEMES[1];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.id === 'dark' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.color);
  document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = theme.id; });
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme.id); } catch { /* The theme still works when browser storage is unavailable. */ }
  }
  return theme.id;
}

export function initializeTheme() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* Private browser settings may block storage. */ }
  return setTheme(saved, false);
}

export function themeSelector() {
  const selected = currentTheme();
  return `<label class="theme-picker"><span class="theme-picker-swatch" aria-hidden="true"></span><span class="theme-picker-label">Тема</span><select data-theme-select aria-label="Цветовая тема">${THEMES.map(t => `<option value="${t.id}"${selected === t.id ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>`;
}

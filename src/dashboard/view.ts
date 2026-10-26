import { formatDateTime } from './dates';
import { failureMessage } from './markup';
import { getDataSourceMeta } from './source';

export function fillSourceNote(): void {
  const note = document.getElementById('source-note');
  if (!note) return;
  const meta = getDataSourceMeta();
  note.textContent = `${meta.label}. Sample clock ${formatDateTime(meta.asOf)}.`;
}

export async function paint(root: HTMLElement, html: string, bind: () => void): Promise<void> {
  const active = document.activeElement;
  const focusId = active instanceof HTMLElement ? active.id : '';
  const range =
    active instanceof HTMLInputElement ? ([active.selectionStart, active.selectionEnd] as const) : null;
  root.innerHTML = html;
  if (focusId) {
    const next = document.getElementById(focusId);
    if (next instanceof HTMLInputElement && range?.[0] != null && range[1] != null) {
      next.focus();
      next.setSelectionRange(range[0], range[1]);
    } else if (next instanceof HTMLElement) {
      next.focus({ preventScroll: true });
    }
  }
  bind();
  root.dataset.ready = 'true';
}

export async function showFailure(root: HTMLElement): Promise<void> {
  root.innerHTML = failureMessage();
  root.dataset.ready = 'true';
}

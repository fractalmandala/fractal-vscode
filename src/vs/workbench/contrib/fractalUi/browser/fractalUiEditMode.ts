/*---------------------------------------------------------------------------------------------
 *  Fractal — UI Edit Mode (dev-only).
 *
 *  Enter the mode (floating "🎨 UI Edit" button or the command), click any element in the
 *  workbench, and edit its look live: background/text/border colors, border width + radius,
 *  padding, font size/weight — and swap codicon glyphs for icons. Changes are applied via an
 *  injected stylesheet with `!important` overrides, persisted to localStorage (survives dev
 *  reloads), and can be copied as CSS or cleared.
 *
 *  Gated to dev surfaces (web dev server port 9888 + desktop dev build), same as the
 *  devAnnotation overlay. Never ship to end users.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { localize2 } from '../../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const STORAGE_KEY = 'fractalUi.overrides';
const DEV_PORT = '9888';

function isDevSurface(): boolean {
	return location.port === DEV_PORT || (location.protocol === 'vscode-file:' && location.hostname === 'vscode-app');
}

/** All registered codicons, e.g. 'codicon-palette'. */
const ALL_CODICONS: readonly string[] = Object.values(Codicon)
	.map((c) => c.id)
	.filter((id): id is string => typeof id === 'string' && id.startsWith('codicon-'))
	.sort();

const STYLES = `
.fui-fab{position:fixed;left:14px;bottom:14px;z-index:999999;display:flex;align-items:center;gap:6px;
  background:#6f42c1;color:#fff;border:none;border-radius:20px;padding:8px 14px;font:600 12px/1 system-ui;
  cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4);}
.fui-fab:hover{background:#7d4fd1;}
.fui-fab.active{background:#a1260d;}
.fui-hint{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999998;background:#1e1e1e;
  color:#fff;border:1px solid #555;border-radius:4px;padding:6px 12px;font:12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.4);}
.fui-target{outline:2px solid #6f42c1 !important;outline-offset:1px !important;cursor:crosshair !important;}
.fui-popover{position:fixed;z-index:999999;width:300px;max-height:80vh;overflow-y:auto;background:#252526;border:1px solid #454545;
  border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.5);font:12px system-ui;color:#cccccc;}
.fui-popover-header{padding:6px 10px;font-weight:600;border-bottom:1px solid #3c3c3c;display:flex;justify-content:space-between;align-items:center;}
.fui-popover-close{cursor:pointer;color:#888;}
.fui-popover-close:hover{color:#fff;}
.fui-sel{display:block;width:100%;box-sizing:border-box;padding:5px 8px;background:#1e1e1e;color:#7dcfff;font:11px/1.4 ui-monospace,Menlo,monospace;
  border:none;border-bottom:1px solid #3c3c3c;word-break:break-all;}
.fui-grid{display:grid;grid-template-columns:1fr auto;gap:5px 8px;padding:8px 10px;align-items:center;}
.fui-grid label{color:#bbb;}
.fui-grid input[type=color]{width:34px;height:22px;padding:0;border:1px solid #555;background:none;cursor:pointer;}
.fui-grid input[type=number]{width:64px;box-sizing:border-box;background:#1e1e1e;color:#fff;border:1px solid #454545;padding:3px 5px;font:11px system-ui;}
.fui-grid select{width:100%;box-sizing:border-box;background:#1e1e1e;color:#fff;border:1px solid #454545;padding:3px 5px;font:11px system-ui;}
.fui-row{display:flex;align-items:center;gap:8px;padding:2px 10px;}
.fui-row input[type=color]{width:34px;height:22px;padding:0;border:1px solid #555;background:none;cursor:pointer;}
.fui-row input[type=text]{flex:1;box-sizing:border-box;background:#1e1e1e;color:#fff;border:1px solid #454545;padding:3px 5px;font:11px ui-monospace,Menlo,monospace;}
.fui-actions{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-top:1px solid #3c3c3c;}
.fui-btn{border:none;border-radius:3px;padding:4px 10px;font:600 11px system-ui;cursor:pointer;}
.fui-btn-apply{background:#0e639c;color:#fff;}
.fui-btn-apply:hover{background:#1177bb;}
.fui-btn-copy{background:#3c3c3c;color:#ccc;}
.fui-btn-copy:hover{background:#4a4a4a;}
.fui-btn-reset{background:#3c3c3c;color:#ccc;}
.fui-btn-reset:hover{background:#4a4a4a;}
.fui-btn-clear{background:#6b2a18;color:#fff;}
.fui-btn-clear:hover{background:#7d3520;}
.fui-css{display:none;width:100%;box-sizing:border-box;min-height:90px;resize:vertical;background:#1e1e1e;color:#9cdcfe;
  border:none;padding:8px 10px;font:11px/1.4 ui-monospace,Menlo,monospace;}
.fui-status{position:fixed;left:14px;bottom:52px;z-index:999998;background:#252526;color:#fff;border:1px solid #454545;
  border-radius:4px;padding:4px 10px;font:11px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.4);}
`;

function isOverlayElement(target: Element): boolean {
	let node: Element | null = target;
	while (node) {
		if (node.classList.contains('fui-fab') || node.classList.contains('fui-popover')) {
			return true;
		}
		node = node.parentElement;
	}
	return false;
}

/** Clean, stable selector for the clicked element (id, or its own/first-ancestor classes). */
function uiSelector(target: Element): string {
	if (target.id) {
		return `#${target.id}`;
	}
	let node: Element | null = target;
	while (node && node !== document.body) {
		const cls = (typeof node.className === 'string' ? node.className : '').split(/\s+/).filter((c) => c && c !== 'codicon');
		if (cls.length) {
			return `${node.tagName.toLowerCase()}.${cls.slice(0, 3).join('.')}`;
		}
		node = node.parentElement;
	}
	return target.tagName.toLowerCase();
}

function codiconClassOf(target: Element): string | undefined {
	let node: Element | null = target;
	while (node && node !== document.body) {
		const cls = (typeof node.className === 'string' ? node.className : '').split(/\s+/).find((c) => c.startsWith('codicon-') && c !== 'codicon');
		if (cls) {
			return cls;
		}
		node = node.parentElement;
	}
	return undefined;
}

function codiconGlyph(codiconClass: string): string | undefined {
	const probe = document.createElement('span');
	probe.className = `codicon ${codiconClass}`;
	probe.style.position = 'absolute';
	probe.style.visibility = 'hidden';
	document.body.appendChild(probe);
	const content = getComputedStyle(probe, '::before').content;
	probe.remove();
	return content && content !== 'none' ? content : undefined;
}

type Overrides = Record<string, Record<string, string>>;

export class FractalUiEditMode extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.fractalUiEditMode';

	private static _instance: FractalUiEditMode | undefined;
	static toggle(): void {
		FractalUiEditMode._instance?.toggleMode();
	}

	private fab: HTMLButtonElement | undefined;
	private hint: HTMLDivElement | undefined;
	private activeTarget: Element | undefined;
	private overrides: Overrides = {};
	private liveStyle: HTMLStyleElement | undefined;

	constructor() {
		super();
		if (!isDevSurface()) {
			return;
		}
		FractalUiEditMode._instance = this;
		this.loadOverrides();
		this.mount();
	}

	private loadOverrides(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			this.overrides = raw ? JSON.parse(raw) as Overrides : {};
		} catch {
			this.overrides = {};
		}
	}

	private mount(): void {
		const style = document.createElement('style');
		style.textContent = STYLES;
		document.head.appendChild(style);
		this._register({ dispose: () => style.remove() });

		this.liveStyle = document.createElement('style');
		this.liveStyle.id = 'fractal-ui-live';
		document.head.appendChild(this.liveStyle);
		this._register({ dispose: () => this.liveStyle?.remove() });
		this.rebuildStyle();

		this.fab = document.createElement('button');
		this.fab.type = 'button';
		this.fab.className = 'fui-fab';
		this.fab.textContent = '🎨 UI Edit';
		this.fab.title = 'Fractal UI Edit Mode — click any element to restyle it';
		this.fab.addEventListener('click', (event) => {
			event.stopPropagation();
			this.toggleMode();
		});
		document.body.appendChild(this.fab);
		this._register({ dispose: () => this.fab?.remove() });

		this.hint = document.createElement('div');
		this.hint.className = 'fui-hint';
		this.hint.style.display = 'none';
		this.hint.textContent = 'UI Edit mode — click any element to restyle it (Esc to exit)';
		document.body.appendChild(this.hint);
		this._register({ dispose: () => this.hint?.remove() });

		document.addEventListener('keydown', this.onKeyDown);
		this._register({ dispose: () => document.removeEventListener('keydown', this.onKeyDown) });
	}

	private toggleMode(): void {
		const active = this.fab?.classList.toggle('active') ?? false;
		this.fab!.textContent = active ? '✕ Done' : '🎨 UI Edit';
		if (this.hint) {
			this.hint.style.display = active ? 'block' : 'none';
		}
		document.body.classList.toggle('fui-mode', active);
		if (active) {
			document.addEventListener('mouseover', this.onMouseOver, true);
			document.addEventListener('mouseout', this.onMouseOut, true);
			document.addEventListener('click', this.onClickCapture, true);
		} else {
			document.removeEventListener('mouseover', this.onMouseOver, true);
			document.removeEventListener('mouseout', this.onMouseOut, true);
			document.removeEventListener('click', this.onClickCapture, true);
			this.clearTarget();
		}
	}

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape' && this.fab?.classList.contains('active')) {
			this.toggleMode();
		}
	};

	private readonly onMouseOver = (event: MouseEvent): void => {
		const target = event.target as Element;
		if (!target || isOverlayElement(target)) {
			return;
		}
		this.clearTarget();
		this.activeTarget = target;
		target.classList.add('fui-target');
	};

	private readonly onMouseOut = (event: MouseEvent): void => {
		if (event.target === this.activeTarget) {
			this.clearTarget();
		}
	};

	private clearTarget(): void {
		this.activeTarget?.classList.remove('fui-target');
		this.activeTarget = undefined;
	}

	private readonly onClickCapture = (event: MouseEvent): void => {
		const target = event.target as Element;
		if (!target || isOverlayElement(target)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.openInspector(target, event.clientX, event.clientY);
	};

	private openInspector(target: Element, x: number, y: number): void {
		this.clearTarget();
		this.toggleMode();

		const selector = uiSelector(target);
		const codicon = codiconClassOf(target);
		const computed = getComputedStyle(target);

		const popover = document.createElement('div');
		popover.className = 'fui-popover';

		const header = document.createElement('div');
		header.className = 'fui-popover-header';
		const title = document.createElement('span');
		title.textContent = selector;
		const close = document.createElement('span');
		close.className = 'fui-popover-close';
		close.textContent = '✕';
		header.append(title, close);

		const selBox = document.createElement('div');
		selBox.className = 'fui-sel';
		selBox.textContent = selector;

		const grid = document.createElement('div');
		grid.className = 'fui-grid';

		const controls: { label: string; prop: string; value: string }[] = [
			{ label: 'Background', prop: 'background-color', value: computed.backgroundColor },
			{ label: 'Text color', prop: 'color', value: computed.color },
			{ label: 'Border color', prop: 'border-color', value: computed.borderColor },
			{ label: 'Border width (px)', prop: 'border-width', value: computed.borderWidth },
			{ label: 'Border radius (px)', prop: 'border-radius', value: computed.borderRadius },
			{ label: 'Padding (px)', prop: 'padding', value: computed.padding },
			{ label: 'Font size (px)', prop: 'font-size', value: computed.fontSize },
			{ label: 'Font weight', prop: 'font-weight', value: computed.fontWeight }
		];

		const inputs: HTMLElement[] = [];
		for (const c of controls) {
			const label = document.createElement('label');
			label.textContent = c.label;
			const isColor = c.prop.endsWith('color');
			const input = document.createElement(isColor ? 'input' : 'input') as HTMLInputElement;
			if (isColor) {
				input.type = 'color';
				input.value = toHex(c.value);
			} else {
				input.type = 'number';
				input.value = String(parseFloat(c.value) || 0);
				input.min = '0';
			}
			const prop = c.prop;
			input.addEventListener('input', () => {
				const v = isColor ? input.value : `${input.value}px`;
				this.apply(selector, prop, v);
			});
			grid.append(label, input);
			inputs.push(input);
		}

		const actions = document.createElement('div');
		actions.className = 'fui-actions';
		const apply = document.createElement('button');
		apply.className = 'fui-btn fui-btn-apply';
		apply.textContent = 'Apply';
		const copy = document.createElement('button');
		copy.className = 'fui-btn fui-btn-copy';
		copy.textContent = 'Copy CSS';
		const reset = document.createElement('button');
		reset.className = 'fui-btn fui-btn-reset';
		reset.textContent = 'Reset element';
		const clearAll = document.createElement('button');
		clearAll.className = 'fui-btn fui-btn-clear';
		clearAll.textContent = 'Clear all';
		actions.append(apply, copy, reset, clearAll);

		const cssBox = document.createElement('textarea');
		cssBox.className = 'fui-css';
		cssBox.readOnly = true;
		cssBox.value = this.cssFor(selector);

		popover.append(header, selBox, grid, actions, cssBox);

		const clampedX = Math.min(Math.max(12, x), window.innerWidth - 320);
		const clampedY = Math.min(Math.max(12, y), window.innerHeight - 480);
		popover.style.left = `${clampedX}px`;
		popover.style.top = `${clampedY}px`;
		document.body.appendChild(popover);

		const disposePopover = () => popover.remove();
		close.addEventListener('click', disposePopover);
		popover.addEventListener('click', (event) => event.stopPropagation());
		this._register({ dispose: disposePopover });

		apply.addEventListener('click', () => {
			apply.textContent = 'Applied ✓';
			setTimeout(() => { apply.textContent = 'Apply'; }, 1200);
		});

		copy.addEventListener('click', () => {
			const css = this.cssFor(selector);
			navigator.clipboard.writeText(css).then(() => this.showStatus('CSS copied ✓', false)).catch(() => {
				cssBox.style.display = 'block';
				cssBox.select();
			});
		});

		reset.addEventListener('click', () => {
			this.removeSelector(selector);
			this.showStatus('Reset', false);
		});

		clearAll.addEventListener('click', () => {
			this.overrides = {};
			this.rebuildStyle();
			this.showStatus('All overrides cleared', false);
		});

		// Icon picker (only when the element is (or contains) a codicon)
		if (codicon) {
			const row = document.createElement('div');
			row.className = 'fui-row';
			const label = document.createElement('label');
			label.textContent = 'Icon';
			const pick = document.createElement('select');
			const current = codiconGlyph(codicon);
			for (const id of ALL_CODICONS) {
				const opt = document.createElement('option');
				opt.value = id;
				opt.textContent = id.replace('codicon-', '');
				opt.selected = id === codicon;
				pick.appendChild(opt);
			}
			const glyphBox = document.createElement('input');
			glyphBox.type = 'text';
			glyphBox.placeholder = 'glyph (auto)';
			glyphBox.value = current ?? '';
			pick.addEventListener('change', () => {
				const glyph = codiconGlyph(pick.value);
				if (glyph) {
					this.apply(`.${codicon}::before`, 'content', glyph);
					glyphBox.value = glyph;
				}
			});
			row.append(label, pick, glyphBox);
			popover.insertBefore(row, actions);
		}

		this.showStatus(`Editing ${selector}`, false);
	}

	private apply(selector: string, prop: string, value: string): void {
		const existing = this.overrides[selector] ?? {};
		existing[prop] = value;
		this.overrides[selector] = existing;
		this.rebuildStyle();
	}

	private removeSelector(selector: string): void {
		delete this.overrides[selector];
		this.rebuildStyle();
	}

	private cssFor(selector: string): string {
		const props = this.overrides[selector] ?? {};
		const decls = Object.entries(props).map(([k, v]) => `\t${k}: ${v} !important;`).join('\n');
		return decls ? `${selector} {\n${decls}\n}` : '';
	}

	private rebuildStyle(): void {
		if (!this.liveStyle) {
			return;
		}
		const blocks: string[] = [];
		for (const [selector, props] of Object.entries(this.overrides)) {
			const decls = Object.entries(props).map(([k, v]) => `\t${k}: ${v} !important;`).join('\n');
			if (decls) {
				blocks.push(`${selector} {\n${decls}\n}`);
			}
		}
		this.liveStyle.textContent = blocks.join('\n');
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides));
		} catch {
			// storage full/unavailable — keep going for the session
		}
	}

	private showStatus(text: string, isError: boolean): void {
		const status = document.createElement('div');
		status.className = 'fui-status';
		status.style.borderColor = isError ? '#a1260d' : '#6f42c1';
		status.textContent = text;
		document.body.appendChild(status);
		setTimeout(() => status.remove(), 3000);
	}
}

function toHex(rgb: string): string {
	if (/^#[0-9a-fA-F]{3,8}$/.test(rgb)) {
		return rgb.length === 4 ? `#${rgb.slice(1).split('').map((c) => c + c).join('')}` : rgb;
	}
	const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (m) {
		const to = (n: number) => n.toString(16).padStart(2, '0');
		return `#${to(+m[1])}${to(+m[2])}${to(+m[3])}`;
	}
	return '#000000';
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.fractalUiEditMode',
			title: localize2('fractalUi.toggle', 'Fractal: Toggle UI Edit Mode'),
			f1: true
		});
	}
	run(): void {
		FractalUiEditMode.toggle();
	}
});

registerWorkbenchContribution2(FractalUiEditMode.ID, FractalUiEditMode, WorkbenchPhase.AfterRestored);

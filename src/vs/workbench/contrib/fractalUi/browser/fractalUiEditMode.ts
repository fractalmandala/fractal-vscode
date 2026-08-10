/*---------------------------------------------------------------------------------------------
 *  Fractal — UI Edit Mode (fork utility).
 *
 *  Toggle from the status bar ("🎨 UI Edit", left side) or the command palette
 *  ("Fractal: Toggle UI Edit Mode"). While active, click any element in the workbench to
 *  restyle it live: background/text/border colors, border width + radius, padding (each
 *  with per-side control), font size/weight — plus icons: swap codicon glyphs, upload a
 *  custom SVG (file picker, pasted markup, or URL), and attach raw custom CSS per element.
 *  Changes are applied via an injected stylesheet with `!important` overrides, persisted
 *  to localStorage (survives reloads), and can be copied as CSS or cleared.
 *
 *  The mode stays active across edits: close an inspector with ✕/Esc and keep clicking.
 *  Fork customization: a first-class utility of this fork's builds — active on desktop
 *  builds (vscode-file://) and the web dev server (port 9888).
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { getCodiconFontCharacters } from '../../../../base/common/codiconsUtil.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStatusbarService, StatusbarAlignment, type IStatusbarEntryAccessor } from '../../../services/statusbar/browser/statusbar.js';
import { localize2 } from '../../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const STORAGE_KEY = 'fractalUi.overrides';
const CUSTOM_CSS_KEY = 'fractalUi.customCss';
const DEV_PORT = '9888';
const TOGGLE_COMMAND = 'workbench.action.fractalUiEditMode';

function isDevSurface(): boolean {
	return location.port === DEV_PORT || (location.protocol === 'vscode-file:' && location.hostname === 'vscode-app');
}

/** Bare codicon names (no 'codicon-' prefix) + their codepoints. */
const CODICON_GLYPHS: ReadonlyMap<string, number> = new Map(Object.entries(getCodiconFontCharacters()));
const ALL_CODICONS: readonly string[] = [...CODICON_GLYPHS.keys()].sort();

const STYLES = `
.fui-hint{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999998;background:#1e1e1e;
  color:#fff;border:1px solid #555;border-radius:4px;padding:6px 12px;font:12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.4);}
.fui-target{outline:2px solid #6f42c1 !important;outline-offset:1px !important;cursor:crosshair !important;}
.fui-popover{position:fixed;z-index:999999;width:320px;max-height:80vh;overflow-y:auto;background:#252526;border:1px solid #454545;
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
.fui-row{display:flex;align-items:center;gap:6px;padding:2px 10px;}
.fui-row label{color:#bbb;min-width:92px;}
.fui-row input[type=color]{width:34px;height:22px;padding:0;border:1px solid #555;background:none;cursor:pointer;}
.fui-row input[type=text]{flex:1;box-sizing:border-box;background:#1e1e1e;color:#fff;border:1px solid #454545;padding:3px 5px;font:11px ui-monospace,Menlo,monospace;}
.fui-row select{flex:1;box-sizing:border-box;background:#1e1e1e;color:#fff;border:1px solid #454545;padding:3px 5px;font:11px system-ui;}
.fui-side-inputs{display:flex;gap:4px;flex:1;}
.fui-side-inputs input{width:100%;box-sizing:border-box;background:#1e1e1e;color:#fff;border:1px solid #454545;padding:3px 4px;font:11px system-ui;text-align:center;}
.fui-side-inputs input::placeholder{color:#666;}
.fui-linkbtn{border:1px solid #454545;background:#2d2d2d;color:#ccc;border-radius:3px;padding:3px 6px;font:600 10px system-ui;cursor:pointer;}
.fui-linkbtn:hover{background:#3a3a3a;}
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
.fui-csswrap{padding:6px 10px 8px;border-top:1px dashed #3c3c3c;}
.fui-csswrap label{display:block;color:#bbb;margin-bottom:4px;}
.fui-csstext{display:block;width:100%;box-sizing:border-box;min-height:72px;resize:vertical;background:#1e1e1e;color:#9cdcfe;
  border:1px solid #454545;padding:6px 8px;font:11px/1.4 ui-monospace,Menlo,monospace;}
.fui-status{position:fixed;left:14px;bottom:52px;z-index:999998;background:#252526;color:#fff;border:1px solid #454545;
  border-radius:4px;padding:4px 10px;font:11px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.4);}
.fui-fab{position:fixed;left:14px;bottom:14px;z-index:999999;display:flex;align-items:center;gap:6px;
  background:#6f42c1;color:#fff;border:none;border-radius:20px;padding:8px 14px;font:600 12px/1 system-ui;
  cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4);}
.fui-fab:hover{background:#7d4fd1;}
.fui-fab.active{background:#a1260d;}
`;

function isOverlayElement(target: Element): boolean {
	let node: Element | null = target;
	while (node) {
		if (node.classList.contains('fui-popover') || node.classList.contains('fui-fab')) {
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

function codiconBareOf(target: Element): string | undefined {
	let node: Element | null = target;
	while (node && node !== document.body) {
		const cls = (typeof node.className === 'string' ? node.className : '').split(/\s+/).find((c) => c.startsWith('codicon-'));
		if (cls) {
			return cls.slice('codicon-'.length);
		}
		node = node.parentElement;
	}
	return undefined;
}

function glyphContent(bareName: string): string | undefined {
	const cp = CODICON_GLYPHS.get(bareName);
	return cp === undefined ? undefined : `"\\${cp.toString(16)}"`;
}

/** Stable selector for an <svg> element; falls back to "<parent selector> svg". */
function svgSelectorOf(svg: Element, parentSelector: string): string {
	if (svg.id) {
		return `#${svg.id}`;
	}
	const cls = (svg.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
	if (cls.length) {
		return `svg.${cls.slice(0, 3).join('.')}`;
	}
	return `${parentSelector} svg`;
}

function toSvgDataUri(svgMarkup: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup.trim())}`;
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

function pxValue(css: string): number {
	return parseFloat(css) || 0;
}

type Overrides = Record<string, Record<string, string>>;

export class FractalUiEditMode extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.fractalUiEditMode';

	private static _instance: FractalUiEditMode | undefined;
	static toggle(): void {
		FractalUiEditMode._instance?.toggleMode();
	}

	private active = false;
	private hint: HTMLDivElement | undefined;
	private fab: HTMLButtonElement | undefined;
	private statusAccessor: IStatusbarEntryAccessor | undefined;
	private activeTarget: Element | undefined;
	private popover: HTMLElement | undefined;
	private popoverSelector = '';
	private overrides: Overrides = {};
	private customCss: Record<string, string> = {};
	private liveStyle: HTMLStyleElement | undefined;

	constructor(@IInstantiationService private readonly instantiationService: IInstantiationService) {
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
		try {
			const rawCss = localStorage.getItem(CUSTOM_CSS_KEY);
			this.customCss = rawCss ? JSON.parse(rawCss) as Record<string, string> : {};
		} catch {
			this.customCss = {};
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

		this.hint = document.createElement('div');
		this.hint.className = 'fui-hint';
		this.hint.style.display = 'none';
		this.hint.textContent = 'UI Edit mode — click any element to restyle it (Esc to exit)';
		document.body.appendChild(this.hint);
		this._register({ dispose: () => this.hint?.remove() });

		document.addEventListener('keydown', this.onKeyDown);
		this._register({ dispose: () => document.removeEventListener('keydown', this.onKeyDown) });

		// Prefer the status bar; fall back to a floating button only if there is none.
		try {
			const entry = {
				name: 'Fractal UI Edit',
				text: '$(palette) UI Edit',
				ariaLabel: 'Fractal UI Edit Mode',
				tooltip: 'Fractal UI Edit Mode — click any element to restyle it',
				command: TOGGLE_COMMAND
			};
			const accessor = this.instantiationService.invokeFunction((a) => a.get(IStatusbarService))
				.addEntry(entry, 'status.fractalUiEdit', StatusbarAlignment.LEFT, 100);
			this.statusAccessor = accessor;
			this._register({ dispose: () => accessor.dispose() });
		} catch {
			this.mountFab();
		}
	}

	private mountFab(): void {
		this.fab = document.createElement('button');
		this.fab.type = 'button';
		this.fab.className = 'fui-fab';
		this.fab.textContent = '🎨 UI Edit';
		this.fab.addEventListener('click', (event) => {
			event.stopPropagation();
			this.toggleMode();
		});
		document.body.appendChild(this.fab);
		this._register({ dispose: () => this.fab?.remove() });
		this.updateFab();
	}

	private toggleMode(): void {
		this.active = !this.active;
		if (this.hint) {
			this.hint.style.display = this.active ? 'block' : 'none';
		}
		document.body.classList.toggle('fui-mode', this.active);
		if (this.active) {
			document.addEventListener('mouseover', this.onMouseOver, true);
			document.addEventListener('mouseout', this.onMouseOut, true);
			document.addEventListener('click', this.onClickCapture, true);
		} else {
			document.removeEventListener('mouseover', this.onMouseOver, true);
			document.removeEventListener('mouseout', this.onMouseOut, true);
			document.removeEventListener('click', this.onClickCapture, true);
			this.clearTarget();
			this.closePopover();
		}
		this.updateFab();
		this.updateStatusEntry();
	}

	private updateFab(): void {
		if (!this.fab) {
			return;
		}
		this.fab.textContent = this.active ? '✕ Done' : '🎨 UI Edit';
		this.fab.classList.toggle('active', this.active);
	}

	private updateStatusEntry(): void {
		this.statusAccessor?.update({
			name: 'Fractal UI Edit',
			text: this.active ? '$(check) UI Edit' : '$(palette) UI Edit',
			ariaLabel: 'Fractal UI Edit Mode',
			tooltip: this.active ? 'UI Edit Mode active — click any element (Esc to exit)' : 'Fractal UI Edit Mode — click any element to restyle it',
			command: TOGGLE_COMMAND,
			backgroundColor: this.active ? '#6f42c1' : undefined
		});
	}

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') {
			return;
		}
		if (this.popover) {
			this.closePopover();
		} else if (this.active) {
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
		this.closePopover();
		this.openInspector(target, event.clientX, event.clientY);
	};

	private closePopover(): void {
		this.popover?.remove();
		this.popover = undefined;
	}

	private openInspector(target: Element, x: number, y: number): void {
		this.clearTarget();

		const selector = uiSelector(target);
		const codiconBare = codiconBareOf(target);
		const computed = getComputedStyle(target);
		this.popoverSelector = selector;

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

		const addColorControl = (label: string, prop: string, value: string) => {
			const lbl = document.createElement('label');
			lbl.textContent = label;
			const input = document.createElement('input');
			input.type = 'color';
			input.value = toHex(value);
			input.addEventListener('input', () => this.apply(selector, prop, input.value));
			grid.append(lbl, input);
		};

		const addNumberControl = (label: string, prop: string, value: string) => {
			const lbl = document.createElement('label');
			lbl.textContent = label;
			const input = document.createElement('input');
			input.type = 'number';
			input.value = String(pxValue(value));
			input.min = '0';
			input.addEventListener('input', () => this.apply(selector, prop, `${input.value}px`));
			grid.append(lbl, input);
		};

		addColorControl('Background', 'background-color', computed.backgroundColor);
		addColorControl('Text color', 'color', computed.color);
		addColorControl('Border color', 'border-color', computed.borderColor);
		addNumberControl('Font size (px)', 'font-size', computed.fontSize);

		// Font weight
		const fwLabel = document.createElement('label');
		fwLabel.textContent = 'Font weight';
		const fw = document.createElement('select');
		for (const w of ['400', '500', '600', '700']) {
			const opt = document.createElement('option');
			opt.value = w;
			opt.textContent = w;
			opt.selected = Math.round(pxValue(computed.fontWeight)).toString() === w;
			fw.appendChild(opt);
		}
		fw.addEventListener('change', () => this.apply(selector, 'font-weight', fw.value));
		grid.append(fwLabel, fw);

		popover.append(header, selBox, grid);

		// Per-side controls: border width, border radius, padding
		this.addSideControl(popover, 'Border width', 'border-width', {
			top: computed.borderTopWidth,
			right: computed.borderRightWidth,
			bottom: computed.borderBottomWidth,
			left: computed.borderLeftWidth
		}, selector);
		this.addSideControl(popover, 'Border radius', 'border-radius', {
			top: computed.borderTopLeftRadius,
			right: computed.borderTopRightRadius,
			bottom: computed.borderBottomRightRadius,
			left: computed.borderBottomLeftRadius
		}, selector);
		this.addSideControl(popover, 'Padding', 'padding', {
			top: computed.paddingTop,
			right: computed.paddingRight,
			bottom: computed.paddingBottom,
			left: computed.paddingLeft
		}, selector);

		// Icons: codicon swap + custom SVG upload
		this.addIconControl(popover, selector, codiconBare, target);

		// Raw custom CSS for this element
		this.addCustomCssControl(popover, selector);

		const actions = document.createElement('div');
		actions.className = 'fui-actions';
		const apply = document.createElement('button');
		apply.className = 'fui-btn fui-btn-apply';
		apply.textContent = 'Done';
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

		popover.append(actions, cssBox);

		const clampedX = Math.min(Math.max(12, x), window.innerWidth - 340);
		const clampedY = Math.min(Math.max(12, y), window.innerHeight - 560);
		popover.style.left = `${clampedX}px`;
		popover.style.top = `${clampedY}px`;
		document.body.appendChild(popover);
		this.popover = popover;
		this._register({ dispose: () => popover.remove() });

		close.addEventListener('click', () => this.closePopover());
		popover.addEventListener('click', (event) => event.stopPropagation());

		apply.addEventListener('click', () => this.closePopover());
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
			this.customCss = {};
			this.rebuildStyle();
			this.showStatus('All overrides cleared', false);
		});

		this.showStatus(`Editing ${selector} — stays active, click another element`, false);
	}

	private addSideControl(parent: HTMLElement, label: string, prop: string, sides: { top: string; right: string; bottom: string; left: string }, selector: string): void {
		const row = document.createElement('div');
		row.className = 'fui-row';
		const lbl = document.createElement('label');
		lbl.textContent = label;

		const linkBtn = document.createElement('button');
		linkBtn.type = 'button';
		linkBtn.className = 'fui-linkbtn';
		linkBtn.title = 'Toggle: all sides together / each side separately';

		const inputsHost = document.createElement('div');
		inputsHost.className = 'fui-side-inputs';

		const buildLinked = () => {
			inputsHost.replaceChildren();
			linkBtn.textContent = '🔗 all';
			const all = document.createElement('input');
			all.type = 'number';
			all.min = '0';
			all.value = String(pxValue(sides.top));
			all.addEventListener('input', () => this.apply(selector, prop, `${all.value}px`));
			inputsHost.appendChild(all);
		};

		const buildSides = () => {
			inputsHost.replaceChildren();
			linkBtn.textContent = '⊞ sides';
			const parts: [string, string, string][] = [
				['T', 'top', sides.top],
				['R', 'right', sides.right],
				['B', 'bottom', sides.bottom],
				['L', 'left', sides.left]
			];
			for (const [hint, side, value] of parts) {
				const input = document.createElement('input');
				input.type = 'number';
				input.min = '0';
				input.placeholder = hint;
				input.value = String(pxValue(value));
				const propName = `${prop}-${side}`;
				input.addEventListener('input', () => this.apply(selector, propName, `${input.value}px`));
				inputsHost.appendChild(input);
			}
		};

		let linked = true;
		buildLinked();
		linkBtn.addEventListener('click', () => {
			linked = !linked;
			if (linked) {
				buildLinked();
			} else {
				buildSides();
			}
		});

		row.append(lbl, linkBtn, inputsHost);
		parent.appendChild(row);
	}

	private addIconControl(parent: HTMLElement, selector: string, codiconBare: string | undefined, target: Element): void {
		// Codicon glyph swap (only when the element carries a codicon-* class)
		if (codiconBare) {
			const row = document.createElement('div');
			row.className = 'fui-row';
			const lbl = document.createElement('label');
			lbl.textContent = 'Icon';
			const pick = document.createElement('select');
			for (const bare of ALL_CODICONS) {
				const opt = document.createElement('option');
				opt.value = bare;
				opt.textContent = bare;
				opt.selected = bare === codiconBare;
				pick.appendChild(opt);
			}
			const cls = `codicon-${codiconBare}`;
			pick.addEventListener('change', () => {
				const content = glyphContent(pick.value);
				if (content) {
					this.apply(`.${cls}::before`, 'content', content);
					this.removeSelectorProp(`.${cls}::before`, 'background-image');
					this.showStatus(`Icon → ${pick.value}`, false);
				}
			});
			row.append(lbl, pick);
			parent.appendChild(row);
		}

		// Custom SVG: upload a .svg file, or paste markup / a URL
		const row = document.createElement('div');
		row.className = 'fui-row';
		const lbl = document.createElement('label');
		lbl.textContent = 'Custom SVG';

		const uploadBtn = document.createElement('button');
		uploadBtn.type = 'button';
		uploadBtn.className = 'fui-linkbtn';
		uploadBtn.textContent = 'Upload…';
		uploadBtn.title = 'Upload a .svg file to replace this icon';
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = '.svg,image/svg+xml';
		fileInput.style.display = 'none';
		uploadBtn.addEventListener('click', () => fileInput.click());
		fileInput.addEventListener('change', () => {
			const file = fileInput.files?.[0];
			if (!file) {
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const markup = String(reader.result ?? '');
				if (markup.includes('<svg')) {
					this.applySvgIcon(target, selector, codiconBare, toSvgDataUri(markup));
				} else {
					this.showStatus('That file is not an SVG', true);
				}
			};
			reader.onerror = () => this.showStatus('Could not read the file', true);
			reader.readAsText(file);
		});

		const svgInput = document.createElement('input');
		svgInput.type = 'text';
		svgInput.placeholder = codiconBare ? `…or paste <svg>… / URL (current: ${codiconBare})` : 'Paste <svg>… markup or https://… URL';
		svgInput.title = 'Paste an SVG (Lucide/custom, may be animated) or a URL to use instead of the current icon';
		svgInput.addEventListener('change', () => {
			const v = svgInput.value.trim();
			if (!v) {
				return;
			}
			this.applySvgIcon(target, selector, codiconBare, v.startsWith('<svg') ? toSvgDataUri(v) : v);
		});

		row.append(lbl, uploadBtn, fileInput, svgInput);
		parent.appendChild(row);
	}

	/** Replace the inspected icon with a custom SVG (data URI or URL). */
	private applySvgIcon(target: Element, selector: string, codiconBare: string | undefined, uri: string): void {
		if (codiconBare) {
			// Codicon glyph element: blank the font glyph, draw the SVG as background of ::before
			const s = `.codicon-${codiconBare}::before`;
			this.apply(s, 'content', `''`);
			this.apply(s, 'display', 'inline-block');
			this.apply(s, 'width', '1em');
			this.apply(s, 'height', '1em');
			this.apply(s, 'background-image', `url("${uri}")`);
			this.apply(s, 'background-size', 'contain');
			this.apply(s, 'background-position', 'center');
			this.apply(s, 'background-repeat', 'no-repeat');
		} else {
			// Real <svg> icon (or any element): hide the original shapes, draw the SVG as background
			const svg = target.closest('svg') ?? target.querySelector('svg');
			const s = svg ? svgSelectorOf(svg, selector) : selector;
			if (svg) {
				this.apply(`${s} *`, 'display', 'none');
			}
			this.apply(s, 'background-image', `url("${uri}")`);
			this.apply(s, 'background-size', 'contain');
			this.apply(s, 'background-position', 'center');
			this.apply(s, 'background-repeat', 'no-repeat');
		}
		this.showStatus('Custom SVG applied', false);
	}

	/** Raw CSS editor: injected verbatim for the inspected element, persisted per selector. */
	private addCustomCssControl(parent: HTMLElement, selector: string): void {
		const wrap = document.createElement('div');
		wrap.className = 'fui-csswrap';
		const lbl = document.createElement('label');
		lbl.textContent = 'Custom CSS (raw, injected verbatim)';
		const area = document.createElement('textarea');
		area.className = 'fui-csstext';
		area.spellcheck = false;
		area.placeholder = `/* raw CSS for this element, e.g.\n${selector} { color: #f00 !important; }\n${selector}::before { transform: scale(1.2); } */`;
		area.value = this.customCss[selector] ?? '';
		area.addEventListener('input', () => {
			if (area.value.trim()) {
				this.customCss[selector] = area.value;
			} else {
				delete this.customCss[selector];
			}
			this.rebuildStyle();
			this.refreshCssBox();
		});
		wrap.append(lbl, area);
		parent.appendChild(wrap);
	}

	private apply(selector: string, prop: string, value: string): void {
		const existing = this.overrides[selector] ?? {};
		existing[prop] = value;
		this.overrides[selector] = existing;
		this.rebuildStyle();
		this.refreshCssBox();
	}

	private removeSelectorProp(selector: string, prop: string): void {
		const existing = this.overrides[selector];
		if (existing) {
			delete existing[prop];
			this.rebuildStyle();
			this.refreshCssBox();
		}
	}

	private removeSelector(selector: string): void {
		delete this.overrides[selector];
		delete this.customCss[selector];
		this.rebuildStyle();
		this.refreshCssBox();
	}

	private refreshCssBox(): void {
		const cssBox = this.popover?.querySelector<HTMLTextAreaElement>('.fui-css');
		if (cssBox) {
			cssBox.value = this.cssFor(this.popoverSelector);
		}
	}

	private cssFor(selector: string): string {
		const props = this.overrides[selector] ?? {};
		const decls = Object.entries(props).map(([k, v]) => `\t${k}: ${v} !important;`).join('\n');
		const parts: string[] = [];
		if (decls) {
			parts.push(`${selector} {\n${decls}\n}`);
		}
		const raw = (this.customCss[selector] ?? '').trim();
		if (raw) {
			parts.push(raw);
		}
		return parts.join('\n');
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
		for (const raw of Object.values(this.customCss)) {
			if (raw.trim()) {
				blocks.push(raw.trim());
			}
		}
		this.liveStyle.textContent = blocks.join('\n');
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides));
			localStorage.setItem(CUSTOM_CSS_KEY, JSON.stringify(this.customCss));
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

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: TOGGLE_COMMAND,
			title: localize2('fractalUi.toggle', 'Fractal: Toggle UI Edit Mode'),
			f1: true
		});
	}
	run(): void {
		FractalUiEditMode.toggle();
	}
});

registerWorkbenchContribution2(FractalUiEditMode.ID, FractalUiEditMode, WorkbenchPhase.AfterRestored);

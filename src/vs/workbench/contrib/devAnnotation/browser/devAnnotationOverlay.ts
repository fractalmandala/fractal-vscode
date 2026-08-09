/*---------------------------------------------------------------------------------------------
 *  SideX — Dev-only annotation overlay.
 *
 *  A tiny, dependency-free replacement for the React-only `agentation` widget:
 *  a floating button in the bottom-right corner of the dev preview. Click it,
 *  then click any element in the workbench to attach a note. Annotations are
 *  pushed to the local agentation-mcp server (http://localhost:4747) using the
 *  same REST protocol the `agentation` package uses, so an agent can read them
 *  back via GET /sessions and GET /pending.
 *
 *  Activation is gated at runtime to the web dev server port (9888), so
 *  production builds are unaffected.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const DEV_PORT = '9888';
const AGENTATION_ENDPOINT = 'http://localhost:4747';
const SESSION_KEY = 'sidexDevAnnotation.sessionId';

/**
 * Dev-only surfaces: the web dev server (port 9888) and the desktop dev build
 * (vscode-file:// origin has no port). A future production packaging step must
 * gate this off (e.g. a product flag or by not shipping the contribution) — it
 * must never ship to end users.
 */
function isDevSurface(): boolean {
	return location.port === DEV_PORT || (location.protocol === 'vscode-file:' && location.hostname === 'vscode-app');
}

interface AnnotationPayload {
	id: string;
	x: number;
	y: number;
	comment: string;
	element: string;
	elementPath: string;
	timestamp: number;
	selectedText?: string;
	boundingBox?: { x: number; y: number; width: number; height: number };
	nearbyText?: string;
	cssClasses?: string;
	accessibility?: string;
	fullPath?: string;
}

const STYLES = `
.sdx-annotate-fab{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;align-items:center;gap:6px;
  background:#0e639c;color:#fff;border:none;border-radius:20px;padding:8px 14px;font:600 12px/1 system-ui;
  cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4);}
.sdx-annotate-fab:hover{background:#1177bb;}
.sdx-annotate-fab.active{background:#a1260d;}
.sdx-annotate-fab-badge{background:rgba(255,255,255,.25);border-radius:10px;padding:0 6px;font-size:11px;}
.sdx-annotate-hint{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999998;background:#1e1e1e;
  color:#fff;border:1px solid #555;border-radius:4px;padding:6px 12px;font:12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.4);}
.sdx-annotate-target{outline:2px solid #0e639c !important;outline-offset:1px !important;cursor:crosshair !important;}
.sdx-annotate-popover{position:fixed;z-index:999999;width:260px;background:#252526;border:1px solid #454545;
  border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.5);font:12px system-ui;color:#cccccc;}
.sdx-annotate-popover-header{padding:6px 10px;font-weight:600;border-bottom:1px solid #3c3c3c;display:flex;justify-content:space-between;align-items:center;}
.sdx-annotate-popover-close{cursor:pointer;color:#888;}
.sdx-annotate-popover-close:hover{color:#fff;}
.sdx-annotate-popover textarea{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;background:#1e1e1e;color:#fff;
  border:none;padding:8px 10px;font:12px/1.4 system-ui;outline:none;}
.sdx-annotate-popover-actions{display:flex;justify-content:flex-end;gap:6px;padding:6px 10px;}
.sdx-annotate-btn{border:none;border-radius:3px;padding:4px 12px;font:600 12px system-ui;cursor:pointer;}
.sdx-annotate-btn-add{background:#0e639c;color:#fff;}
.sdx-annotate-btn-add:hover{background:#1177bb;}
.sdx-annotate-btn-cancel{background:#3c3c3c;color:#ccc;}
.sdx-annotate-btn-cancel:hover{background:#4a4a4a;}
.sdx-annotate-status{position:fixed;right:14px;bottom:52px;z-index:999998;background:#252526;color:#fff;border:1px solid #454545;
  border-radius:4px;padding:4px 10px;font:11px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.4);}
`;

function isOverlayElement(target: Element): boolean {
	let node: Element | null = target;
	while (node) {
		if (node.classList.contains('sdx-annotate-fab') || node.classList.contains('sdx-annotate-popover')) {
			return true;
		}
		node = node.parentElement;
	}
	return false;
}

/** Best-effort CSS-ish selector path, e.g. `body > div.monaco-workbench > div > button`. */
function selectorPath(target: Element): string {
	const parts: string[] = [];
	let node: Element | null = target;
	while (node && node !== document.body && parts.length < 6) {
		let part = node.tagName.toLowerCase();
		if (node.id) {
			part = `#${node.id}`;
		} else if (typeof node.className === 'string' && node.className.trim()) {
			const cls = node.className.trim().split(/\s+/).slice(0, 2).join('.');
			part = `${part}.${cls}`;
		}
		// Disambiguate with nth-of-type only when needed
		if (node.parentElement) {
			const tagName = node.tagName;
			const siblings = Array.from(node.parentElement.children).filter((s) => s.tagName === tagName);
			if (siblings.length > 1) {
				part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
			}
		}
		parts.unshift(part);
		node = node.parentElement;
	}
	return parts.join(' > ');
}

function elementLabel(target: Element): string {
	const role = target.getAttribute('role');
	const label = target.getAttribute('aria-label');
	const name = (target as HTMLElement).textContent?.trim().slice(0, 120) || target.tagName;
	if (role || label) {
		return `${target.tagName}${role ? `[role=${role}]` : ''}${label ? `[label=${label}]` : ''}`;
	}
	return `${target.tagName}: ${name}`;
}

export class DevAnnotationOverlay extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sidexDevAnnotationOverlay';

	private fab: HTMLButtonElement | undefined;
	private hint: HTMLDivElement | undefined;
	private activeTarget: Element | undefined;
	private annotationCount = 0;
	private sessionId: string | undefined;

	constructor() {
		super();
		if (!isDevSurface()) {
			return;
		}
		this.sessionId = localStorage.getItem(SESSION_KEY) ?? undefined;
		this.annotationCount = Number(localStorage.getItem('sidexDevAnnotation.count') ?? 0);
		this.mount();
	}

	private mount(): void {
		const style = document.createElement('style');
		style.textContent = STYLES;
		document.head.appendChild(style);
		this._register({ dispose: () => style.remove() });

		this.fab = document.createElement('button');
		this.fab.type = 'button';
		this.fab.className = 'sdx-annotate-fab';
		this.fab.textContent = '✎ Annotate';
		this.fab.title = 'Annotate the UI for the agent (syncs to agentation-mcp on :4747)';
		this.fab.addEventListener('click', (event) => {
			event.stopPropagation();
			this.toggleMode();
		});
		document.body.appendChild(this.fab);
		this._register({ dispose: () => this.fab?.remove() });
		this.updateBadge();

		this.hint = document.createElement('div');
		this.hint.className = 'sdx-annotate-hint';
		this.hint.style.display = 'none';
		this.hint.textContent = 'Annotate mode — click any element (Esc to exit)';
		document.body.appendChild(this.hint);
		this._register({ dispose: () => this.hint?.remove() });

		document.addEventListener('keydown', this.onKeyDown);
		this._register({ dispose: () => document.removeEventListener('keydown', this.onKeyDown) });
	}

	private toggleMode(): void {
		const active = this.fab?.classList.toggle('active') ?? false;
		this.fab!.textContent = active ? '✕ Done' : '✎ Annotate';
		if (this.hint) {
			this.hint.style.display = active ? 'block' : 'none';
		}
		document.body.classList.toggle('sdx-annotate-mode', active);
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
		target.classList.add('sdx-annotate-target');
	};

	private readonly onMouseOut = (event: MouseEvent): void => {
		if (event.target === this.activeTarget) {
			this.clearTarget();
		}
	};

	private clearTarget(): void {
		this.activeTarget?.classList.remove('sdx-annotate-target');
		this.activeTarget = undefined;
	}

	private readonly onClickCapture = (event: MouseEvent): void => {
		const target = event.target as Element;
		if (!target || isOverlayElement(target)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.openPopover(target, event.clientX, event.clientY);
	};

	private openPopover(target: Element, x: number, y: number): void {
		this.clearTarget();
		this.toggleMode();

		const popover = document.createElement('div');
		popover.className = 'sdx-annotate-popover';

		const header = document.createElement('div');
		header.className = 'sdx-annotate-popover-header';
		const title = document.createElement('span');
		title.textContent = elementLabel(target);
		const close = document.createElement('span');
		close.className = 'sdx-annotate-popover-close';
		close.textContent = '✕';
		header.append(title, close);

		const textarea = document.createElement('textarea');
		textarea.placeholder = 'What should the agent fix or change here?';

		const actions = document.createElement('div');
		actions.className = 'sdx-annotate-popover-actions';
		const cancel = document.createElement('button');
		cancel.className = 'sdx-annotate-btn sdx-annotate-btn-cancel';
		cancel.textContent = 'Cancel';
		const add = document.createElement('button');
		add.className = 'sdx-annotate-btn sdx-annotate-btn-add';
		add.textContent = 'Add annotation';
		actions.append(cancel, add);

		popover.append(header, textarea, actions);

		const clampedX = Math.min(Math.max(12, x), window.innerWidth - 280);
		const clampedY = Math.min(Math.max(12, y), window.innerHeight - 220);
		popover.style.left = `${clampedX}px`;
		popover.style.top = `${clampedY}px`;
		document.body.appendChild(popover);

		const disposePopover = () => popover.remove();
		close.addEventListener('click', disposePopover);
		cancel.addEventListener('click', disposePopover);
		popover.addEventListener('click', (event) => event.stopPropagation());
		textarea.focus();

		add.addEventListener('click', async () => {
			add.disabled = true;
			const ok = await this.submitAnnotation(target, x, y, textarea.value);
			disposePopover();
			this.showStatus(ok ? 'Annotation sent ✓' : 'Failed to send annotation — is agentation-mcp on :4747 running?', ok);
		});

		this._register({ dispose: disposePopover });
	}

	private async submitAnnotation(target: Element, x: number, y: number, comment: string): Promise<boolean> {
		try {
			const sessionId = await this.ensureSession();
			const rect = target.getBoundingClientRect();
			const selection = window.getSelection()?.toString().trim();

			const payload: AnnotationPayload = {
				id: crypto.randomUUID(),
				x,
				y,
				comment: comment.trim() || '(no comment)',
				element: target.tagName.toLowerCase(),
				elementPath: selectorPath(target),
				timestamp: Date.now(),
				boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
				nearbyText: (target.textContent ?? '').trim().slice(0, 200) || undefined,
				cssClasses: typeof target.className === 'string' ? target.className : undefined,
				accessibility: this.accessibilityInfo(target),
				selectedText: selection || undefined,
				fullPath: location.href
			};

			const response = await fetch(`${AGENTATION_ENDPOINT}/sessions/${sessionId}/annotations`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!response.ok) {
				return false;
			}
			this.annotationCount += 1;
			localStorage.setItem('sidexDevAnnotation.count', String(this.annotationCount));
			this.updateBadge();
			return true;
		} catch {
			return false;
		}
	}

	private accessibilityInfo(target: Element): string {
		const role = target.getAttribute('role');
		const label = target.getAttribute('aria-label');
		const name = (target as HTMLElement).textContent?.trim().slice(0, 80);
		return [role ? `role=${role}` : undefined, label ? `label=${label}` : undefined, name ? `name=${name}` : undefined]
			.filter(Boolean)
			.join(' | ');
	}

	private async ensureSession(): Promise<string> {
		if (this.sessionId) {
			return this.sessionId;
		}
		const response = await fetch(`${AGENTATION_ENDPOINT}/sessions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: location.href })
		});
		if (!response.ok) {
			throw new Error(`Failed to create session: ${response.status}`);
		}
		const session = (await response.json()) as { id: string };
		this.sessionId = session.id;
		localStorage.setItem(SESSION_KEY, session.id);
		return session.id;
	}

	private updateBadge(): void {
		if (!this.fab) {
			return;
		}
		this.fab.querySelector('.sdx-annotate-fab-badge')?.remove();
		if (this.annotationCount > 0) {
			const badge = document.createElement('span');
			badge.className = 'sdx-annotate-fab-badge';
			badge.textContent = String(this.annotationCount);
			this.fab.appendChild(badge);
		}
	}

	private showStatus(text: string, isError: boolean): void {
		const status = document.createElement('div');
		status.className = 'sdx-annotate-status';
		status.style.borderColor = isError ? '#a1260d' : '#2ea043';
		status.textContent = text;
		document.body.appendChild(status);
		setTimeout(() => status.remove(), 4000);
	}
}

registerWorkbenchContribution2(DevAnnotationOverlay.ID, DevAnnotationOverlay, WorkbenchPhase.AfterRestored);

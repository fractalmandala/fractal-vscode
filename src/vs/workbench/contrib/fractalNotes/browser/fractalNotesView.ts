/*---------------------------------------------------------------------------------------------
 *  Fractal — Notepad utility (fork utility).
 *
 *  A "Notes" view in the secondary side bar (auxiliary bar). Notes are plain `.md` files
 *  in a user-chosen folder on the local drive, edited inline in the view itself so they
 *  can sit side by side with whatever is open in the main editor:
 *  - On first open it asks for the folder (any location) and remembers it app-wide.
 *  - "New note" creates `<timestamp>.md` and selects it; the title is the file name and
 *    can be renamed.
 *  - The note list stays on top; the selected note is edited in the built-in text area
 *    below and autosaved to its `.md` file as you type.
 *
 *  Fork customization: registered in both the main workbench and the sessions window.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { basename, dirname, isEqual, isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

const VIEW_CONTAINER_ID = 'fractalNotes';
const VIEW_ID = 'fractalNotes.view';
const FOLDER_STORAGE_KEY = 'fractalNotes.folder';

const STYLES = `
.frn-root{display:flex;flex-direction:column;gap:6px;padding:8px;font:12px system-ui;color:#ccc;box-sizing:border-box;overflow:hidden;height:100%;}
.frn-setup{display:flex;flex-direction:column;gap:10px;padding:12px 4px;color:#bbb;line-height:1.5;}
.frn-head{display:flex;align-items:center;gap:6px;}
.frn-folder{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888;font:11px ui-monospace,Menlo,monospace;cursor:pointer;}
.frn-folder:hover{color:#bbb;}
.frn-btn{border:none;border-radius:3px;padding:4px 8px;font:600 11px system-ui;cursor:pointer;background:#3c3c3c;color:#ccc;white-space:nowrap;}
.frn-btn:hover{background:#4a4a4a;}
.frn-btn-primary{background:#0e639c;color:#fff;}
.frn-btn-primary:hover{background:#1177bb;}
.frn-list{flex:0 1 auto;max-height:45%;min-height:24px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;}
.frn-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:3px;cursor:pointer;}
.frn-row:hover{background:#2a2d2e;}
.frn-row.frn-active{background:var(--vscode-list-activeSelectionBackground,#04395e);color:var(--vscode-list-activeSelectionForeground,#fff);}
.frn-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.frn-rename{background:none;border:none;color:#888;cursor:pointer;padding:2px;font-size:12px;}
.frn-rename:hover{color:#fff;}
.frn-empty{color:#888;padding:8px 4px;line-height:1.5;}
.frn-editor{flex:1;min-height:0;display:flex;flex-direction:column;border-top:1px solid var(--vscode-panel-border,#333);}
.frn-edhead{display:flex;align-items:center;gap:6px;padding:6px 2px 4px;}
.frn-edtitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ddd;font-weight:600;}
.frn-iconbtn{background:none;border:none;color:#888;cursor:pointer;padding:2px 3px;font-size:13px;}
.frn-iconbtn:hover{color:#fff;}
.frn-text{flex:1;min-height:0;resize:none;border:none;outline:none;background:transparent;color:var(--vscode-input-foreground,#ccc);font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;padding:6px 4px;box-sizing:border-box;}
.frn-text::placeholder{color:#777;}
.frn-hidden{display:none !important;}
`;

class FractalNotesPane extends ViewPane {

	private root: HTMLElement | undefined;
	private headEl: HTMLElement | undefined;
	private folderLabelEl: HTMLElement | undefined;
	private setupEl: HTMLElement | undefined;
	private listEl: HTMLElement | undefined;
	private editorEl: HTMLElement | undefined;
	private editorTitleEl: HTMLElement | undefined;
	private textEl: HTMLTextAreaElement | undefined;

	private askedForFolder = false;
	private renderToken = 0;
	private renderTimeout: ReturnType<typeof setTimeout> | undefined;
	private loadToken = 0;
	private currentUri: URI | undefined;
	private dirty = false;
	private saveTimeout: ReturnType<typeof setTimeout> | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IEditorService private readonly editorService: IEditorService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register({
			dispose: () => {
				clearTimeout(this.renderTimeout);
				clearTimeout(this.saveTimeout);
				// Best-effort final flush of unsaved text when the view goes away
				if (this.dirty && this.currentUri && this.textEl) {
					void this.fileService.writeFile(this.currentUri, VSBuffer.fromString(this.textEl.value)).then(undefined, () => undefined);
				}
			}
		});
		// Keep the list live when notes change on disk (also from other windows/editors);
		// only the list is rebuilt, never the text area, so typing focus is preserved.
		this._register(this.fileService.onDidFilesChange(e => {
			const folder = this.notesFolder();
			if (!folder) {
				return;
			}
			if ([...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted].some(r => isEqualOrParent(r, folder))) {
				this.scheduleRender();
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const style = document.createElement('style');
		style.textContent = STYLES;
		container.appendChild(style);

		const root = document.createElement('div');
		root.className = 'frn-root';
		this.root = root;
		container.appendChild(root);

		// Header: folder path + actions
		const head = document.createElement('div');
		head.className = 'frn-head';
		const folderLabel = document.createElement('div');
		folderLabel.className = 'frn-folder';
		folderLabel.title = 'Notes folder — click to change';
		folderLabel.addEventListener('click', () => void this.pickFolder());
		const newBtn = document.createElement('button');
		newBtn.className = 'frn-btn frn-btn-primary';
		newBtn.textContent = '+ New note';
		newBtn.addEventListener('click', () => void this.newNote());
		const refreshBtn = document.createElement('button');
		refreshBtn.className = 'frn-btn';
		refreshBtn.textContent = '⟳';
		refreshBtn.title = 'Refresh';
		refreshBtn.addEventListener('click', () => void this.renderNotes());
		head.append(folderLabel, newBtn, refreshBtn);
		this.headEl = head;
		this.folderLabelEl = folderLabel;

		// First-run setup (no folder chosen yet)
		const setup = document.createElement('div');
		setup.className = 'frn-setup frn-hidden';
		const msg = document.createElement('div');
		msg.textContent = 'No notes folder set. Pick any folder on your drive — each note is saved there as a .md file.';
		const chooseBtn = document.createElement('button');
		chooseBtn.className = 'frn-btn frn-btn-primary';
		chooseBtn.textContent = 'Choose notes folder…';
		chooseBtn.addEventListener('click', () => void this.pickFolder());
		setup.append(msg, chooseBtn);
		this.setupEl = setup;

		// Notes list (top)
		const list = document.createElement('div');
		list.className = 'frn-list';
		this.listEl = list;

		// Inline editor (bottom, fills the rest of the view)
		const editor = document.createElement('div');
		editor.className = 'frn-editor';
		const edhead = document.createElement('div');
		edhead.className = 'frn-edhead';
		const edtitle = document.createElement('div');
		edtitle.className = 'frn-edtitle';
		const openBtn = document.createElement('button');
		openBtn.className = 'frn-iconbtn codicon codicon-go-to-file';
		openBtn.title = 'Open in editor';
		openBtn.addEventListener('click', () => {
			if (this.currentUri) {
				void this.editorService.openEditor({ resource: this.currentUri });
			}
		});
		const renameBtn = document.createElement('button');
		renameBtn.className = 'frn-iconbtn codicon codicon-edit';
		renameBtn.title = 'Rename note';
		renameBtn.addEventListener('click', () => {
			if (this.currentUri) {
				void this.renameNote(this.currentUri);
			}
		});
		edhead.append(edtitle, openBtn, renameBtn);
		this.editorTitleEl = edtitle;
		const text = document.createElement('textarea');
		text.className = 'frn-text';
		text.placeholder = 'Select a note above, or create a new one.';
		text.spellcheck = false;
		text.addEventListener('input', () => this.onTextInput());
		this.textEl = text;
		editor.append(edhead, text);
		this.editorEl = editor;

		root.append(head, setup, list, editor);
		void this.renderNotes();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.root) {
			this.root.style.height = `${height}px`;
			this.root.style.width = `${width}px`;
		}
	}

	private notesFolder(): URI | undefined {
		const raw = this.storageService.get(FOLDER_STORAGE_KEY, StorageScope.APPLICATION);
		return raw ? URI.parse(raw) : undefined;
	}

	private scheduleRender(): void {
		if (this.renderTimeout) {
			clearTimeout(this.renderTimeout);
		}
		this.renderTimeout = setTimeout(() => {
			this.renderTimeout = undefined;
			void this.renderNotes();
		}, 250);
	}

	/** Rebuilds only the notes list (and folder label); the inline editor is left untouched. */
	private async renderNotes(): Promise<void> {
		const list = this.listEl;
		if (!list || !this.headEl || !this.setupEl || !this.editorEl || !this.folderLabelEl) {
			return;
		}
		const token = ++this.renderToken;

		const folder = this.notesFolder();
		if (!folder) {
			this.headEl.classList.add('frn-hidden');
			this.listEl?.classList.add('frn-hidden');
			this.editorEl.classList.add('frn-hidden');
			this.setupEl.classList.remove('frn-hidden');
			if (!this.askedForFolder) {
				this.askedForFolder = true;
				void this.pickFolder();
			}
			return;
		}
		this.setupEl.classList.add('frn-hidden');
		this.headEl.classList.remove('frn-hidden');
		list.classList.remove('frn-hidden');
		this.editorEl.classList.remove('frn-hidden');
		this.folderLabelEl.textContent = folder.fsPath || folder.path;

		list.replaceChildren();
		let children;
		try {
			const stat = await this.fileService.resolve(folder);
			children = stat.children ?? [];
		} catch (error) {
			const err = document.createElement('div');
			err.className = 'frn-empty';
			err.textContent = `Cannot read the notes folder (${(error as Error).message}). Click the path above to pick another.`;
			list.appendChild(err);
			return;
		}
		if (token !== this.renderToken) {
			return;
		}

		const notes = children
			.filter(c => !c.isDirectory && c.name.toLowerCase().endsWith('.md'))
			.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
		if (!notes.length) {
			const empty = document.createElement('div');
			empty.className = 'frn-empty';
			empty.textContent = 'No notes yet — create the first one.';
			list.appendChild(empty);
			return;
		}
		for (const note of notes) {
			list.appendChild(this.renderRow(note.resource, note.name));
		}
		// First open: select the most recent note so the editor is ready to use
		if (!this.currentUri && notes.length) {
			void this.selectNote(notes[0].resource);
		}
	}

	private renderRow(resource: URI, fileName: string): HTMLElement {
		const row = document.createElement('div');
		row.className = 'frn-row';
		row.dataset.uri = resource.toString();
		row.title = resource.fsPath || resource.path;
		if (this.currentUri && isEqual(this.currentUri, resource)) {
			row.classList.add('frn-active');
		}
		const title = document.createElement('span');
		title.className = 'frn-title';
		title.textContent = fileName.replace(/\.md$/i, '');
		const rename = document.createElement('button');
		rename.className = 'frn-rename codicon codicon-edit';
		rename.title = 'Rename note';
		rename.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.renameNote(resource);
		});
		row.append(title, rename);
		row.addEventListener('click', () => void this.selectNote(resource));
		return row;
	}

	private refreshActiveRow(): void {
		for (const child of Array.from(this.listEl?.children ?? [])) {
			const uri = (child as HTMLElement).dataset.uri;
			child.classList.toggle('frn-active', !!uri && !!this.currentUri && uri === this.currentUri.toString());
		}
	}

	/** Loads a note into the inline editor (no main-editor jump). */
	private async selectNote(resource: URI): Promise<void> {
		if (this.currentUri && isEqual(this.currentUri, resource)) {
			this.textEl?.focus();
			return;
		}
		await this.flushSave();
		this.currentUri = resource;
		this.dirty = false;
		if (this.editorTitleEl) {
			this.editorTitleEl.textContent = basename(resource).replace(/\.md$/i, '');
		}
		this.refreshActiveRow();
		const token = ++this.loadToken;
		try {
			const content = await this.fileService.readFile(resource);
			if (token !== this.loadToken || !this.textEl) {
				return; // a newer selection won the race
			}
			this.textEl.value = content.value.toString();
		} catch {
			// note vanished on disk; leave the editor as-is
		}
		this.textEl?.focus();
	}

	private onTextInput(): void {
		this.dirty = true;
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = setTimeout(() => void this.save(), 600);
	}

	private async save(): Promise<void> {
		this.saveTimeout = undefined;
		if (!this.dirty || !this.currentUri || !this.textEl) {
			return;
		}
		this.dirty = false;
		try {
			await this.fileService.writeFile(this.currentUri, VSBuffer.fromString(this.textEl.value));
		} catch (error) {
			this.notificationService.error(`Could not save the note: ${(error as Error).message}`);
		}
	}

	private async flushSave(): Promise<void> {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = undefined;
		}
		await this.save();
	}

	private async pickFolder(): Promise<void> {
		try {
			const uris = await this.fileDialogService.showOpenDialog({
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
				title: 'Choose where to store your notes',
				openLabel: 'Use as notes folder'
			});
			const uri = uris?.[0];
			if (!uri) {
				return;
			}
			await this.flushSave();
			this.currentUri = undefined;
			if (this.textEl) {
				this.textEl.value = '';
			}
			if (this.editorTitleEl) {
				this.editorTitleEl.textContent = '';
			}
			this.storageService.store(FOLDER_STORAGE_KEY, uri.toString(), StorageScope.APPLICATION, StorageTarget.USER);
			void this.renderNotes();
		} catch (error) {
			this.notificationService.error(`Could not pick a notes folder: ${(error as Error).message}`);
		}
	}

	private async newNote(): Promise<void> {
		const folder = this.notesFolder();
		if (!folder) {
			return;
		}
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
		let resource = joinPath(folder, `${stamp}.md`);
		let n = 1;
		while (await this.fileService.exists(resource)) {
			resource = joinPath(folder, `${stamp}-${n++}.md`);
		}
		try {
			await this.fileService.writeFile(resource, VSBuffer.fromString(''));
			this.scheduleRender();
			await this.selectNote(resource);
		} catch (error) {
			this.notificationService.error(`Could not create the note: ${(error as Error).message}`);
		}
	}

	private async renameNote(resource: URI): Promise<void> {
		const current = basename(resource).replace(/\.md$/i, '');
		const value = await this.quickInputService.input({
			prompt: 'Note title',
			placeHolder: 'New title (saved as the file name)',
			value: current
		});
		const trimmed = (value ?? '').trim().replace(/[\\/:*?"<>|]/g, '-');
		if (!trimmed || trimmed === current) {
			return;
		}
		const target = joinPath(dirname(resource), `${trimmed}.md`);
		try {
			if (await this.fileService.exists(target)) {
				this.notificationService.warn(`A note named "${trimmed}.md" already exists.`);
				return;
			}
			if (this.currentUri && isEqual(this.currentUri, resource)) {
				await this.flushSave();
				this.currentUri = target;
				if (this.editorTitleEl) {
					this.editorTitleEl.textContent = trimmed;
				}
			}
			await this.fileService.move(resource, target);
			void this.renderNotes();
		} catch (error) {
			this.notificationService.error(`Could not rename the note: ${(error as Error).message}`);
		}
	}
}

const notesViewIcon = registerIcon('fractal-notes-view-icon', Codicon.notebook, localize('fractalNotesViewIcon', 'View icon of the Fractal Notes view.'));

const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer({
	id: VIEW_CONTAINER_ID,
	title: localize2('fractalNotesContainer', "Notes"),
	icon: notesViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: VIEW_CONTAINER_ID,
	hideIfEmpty: true,
	order: 100,
}, ViewContainerLocation.AuxiliaryBar);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews([{
	id: VIEW_ID,
	name: localize2('fractalNotesView', "Notes"),
	ctorDescriptor: new SyncDescriptor(FractalNotesPane),
	canToggleVisibility: true,
}], VIEW_CONTAINER);

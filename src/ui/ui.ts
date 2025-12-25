import { PluginMessage, UIAction } from '../types/messages';
import { decodeHtfig, HtfigDocument } from '../types/file-format';

// UI State Management
type UIState = 'idle' | 'processing' | 'success' | 'error';

class UIManager {
    private statusTextEl: HTMLElement | null;
    private statusBarEl: HTMLElement | null;
    private importBtn: HTMLButtonElement | null;
    private uploadZone: HTMLElement | null;
    private fileInput: HTMLInputElement | null;
    private fileInfo: HTMLElement | null;
    private fileName: HTMLElement | null;
    private fileMeta: HTMLElement | null;
    private removeBtn: HTMLElement | null;
    private errorBox: HTMLElement | null;
    private errorTitle: HTMLElement | null;
    private errorMessage: HTMLElement | null;

    private currentFile: File | null = null;
    private parsedDocument: HtfigDocument | null = null;

    constructor() {
        this.statusTextEl = document.getElementById('status-text');
        this.statusBarEl = document.getElementById('status-bar');
        this.importBtn = document.getElementById('btn-import') as HTMLButtonElement;
        this.uploadZone = document.getElementById('upload-zone');
        this.fileInput = document.getElementById('file-input') as HTMLInputElement;
        this.fileInfo = document.getElementById('file-info');
        this.fileName = document.getElementById('file-name');
        this.fileMeta = document.getElementById('file-meta');
        this.removeBtn = document.getElementById('btn-remove');
        this.errorBox = document.getElementById('error-box');
        this.errorTitle = document.getElementById('error-title');
        this.errorMessage = document.getElementById('error-message');

        this.setupEventListeners();
    }

    private setupEventListeners() {
        // File input change
        this.fileInput?.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files[0]) {
                this.handleFile(target.files[0]);
            }
        });

        // Upload zone click
        this.uploadZone?.addEventListener('click', () => {
            this.fileInput?.click();
        });

        // Drag and drop
        this.uploadZone?.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadZone?.classList.add('dragover');
        });

        this.uploadZone?.addEventListener('dragleave', () => {
            this.uploadZone?.classList.remove('dragover');
        });

        this.uploadZone?.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadZone?.classList.remove('dragover');
            if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
                this.handleFile(e.dataTransfer.files[0]);
            }
        });

        // Remove file button
        this.removeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearFile();
        });

        // Import button
        this.importBtn?.addEventListener('click', () => {
            this.importHtfigFile();
        });
    }

    private async handleFile(file: File) {
        // Validate file extension
        if (!file.name.endsWith('.htfig')) {
            this.showError('Invalid File Type', 'Only .htfig files from the Chrome extension are accepted.');
            return;
        }

        this.currentFile = file;
        this.hideError();

        // Read and validate file content
        try {
            const content = await this.readFileContent(file);
            const { document, validation } = decodeHtfig(content);

            if (!validation.valid) {
                this.showError('Validation Failed', validation.error || 'File format is invalid or corrupted.');
                this.clearFile();
                return;
            }

            this.parsedDocument = document;

            // Show file info
            if (this.uploadZone) this.uploadZone.classList.add('hidden');
            if (this.fileInfo) this.fileInfo.classList.remove('hidden');
            if (this.fileName) this.fileName.textContent = file.name;
            if (this.fileMeta) {
                const layerCount = this.countLayers(document?.layers || []);
                const size = (file.size / 1024).toFixed(1);
                this.fileMeta.textContent = `${layerCount} layer(s) • ${size} KB`;
            }

            if (this.importBtn) this.importBtn.disabled = false;
            this.setState('idle', 'File loaded. Click Import to continue.');

        } catch (err: any) {
            this.showError('File Read Error', err.message);
            this.clearFile();
        }
    }

    private countLayers(layers: any[]): number {
        let count = layers.length;
        for (const layer of layers) {
            if (layer.children && layer.children.length > 0) {
                count += this.countLayers(layer.children);
            }
        }
        return count;
    }

    private readFileContent(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    private clearFile() {
        this.currentFile = null;
        this.parsedDocument = null;

        if (this.uploadZone) this.uploadZone.classList.remove('hidden');
        if (this.fileInfo) this.fileInfo.classList.add('hidden');
        if (this.importBtn) this.importBtn.disabled = true;
        if (this.fileInput) this.fileInput.value = '';

        this.hideError();
        this.setState('idle', 'Ready');
    }

    private showError(title: string, message: string) {
        if (this.errorBox) {
            this.errorBox.classList.remove('hidden');
            // Ensure error box is visible by removing hidden class from potential parents if logical
        }
        if (this.errorTitle) this.errorTitle.textContent = title;
        if (this.errorMessage) this.errorMessage.textContent = message;
    }

    private hideError() {
        if (this.errorBox) this.errorBox.classList.add('hidden');
    }

    private importHtfigFile() {
        if (!this.parsedDocument) {
            this.showError('No File Loaded', 'Please select a .htfig file first.');
            return;
        }

        this.setState('processing', 'Importing layers...');

        // Send layers to Figma sandbox
        parent.postMessage({
            pluginMessage: {
                type: 'generate',
                data: this.parsedDocument.layers
            }
        }, '*');
    }

    public setState(state: UIState, message: string) {
        if (!this.statusBarEl || !this.statusTextEl) return;

        this.statusTextEl.textContent = message;
        this.statusBarEl.setAttribute('data-state', state);

        if (this.importBtn && state !== 'processing') {
            this.importBtn.disabled = !this.parsedDocument;
        } else if (this.importBtn) {
            this.importBtn.disabled = true;
        }
    }
}

const ui = new UIManager();

// Listen for messages from the Sandbox
onmessage = (event) => {
    const msg = event.data.pluginMessage as UIAction;

    if (msg.type === 'status') {
        ui.setState('processing', msg.message);
    } else if (msg.type === 'complete') {
        ui.setState('success', msg.message);
    } else if (msg.type === 'error') {
        ui.setState('error', msg.message);
    } else if (msg.type === 'generate') {
        ui.setState('success', 'Import Complete');
    }
};

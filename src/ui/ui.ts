import { PluginMessage, UIAction } from '../types/messages';
import { decodeHtfig, HtfigDocument } from '../types/file-format';

// UI State Management
type UIState = 'idle' | 'processing' | 'success' | 'error';

/**
 * UIManager - Handles all plugin UI interactions
 * 
 * Manages file upload, validation, progress display, and communication
 * with the Figma sandbox for layer generation.
 */
class UIManager {
    // Element references
    private statusTextEl: HTMLElement | null;
    private statusBarEl: HTMLElement | null;
    private importBtn: HTMLButtonElement | null;
    private importBtnText: HTMLElement | null;
    private uploadZone: HTMLElement | null;
    private fileInput: HTMLInputElement | null;
    private fileInfo: HTMLElement | null;
    private fileName: HTMLElement | null;
    private fileMeta: HTMLElement | null;
    private removeBtn: HTMLElement | null;
    private errorBox: HTMLElement | null;
    private errorTitle: HTMLElement | null;
    private errorMessage: HTMLElement | null;
    private progressContainer: HTMLElement | null;
    private progressFill: HTMLElement | null;
    private progressText: HTMLElement | null;
    private successBox: HTMLElement | null;
    private successText: HTMLElement | null;

    // State
    private currentFile: File | null = null;
    private parsedDocument: HtfigDocument | null = null;
    private currentState: UIState = 'idle';

    constructor() {
        // Initialize element references
        this.statusTextEl = document.getElementById('status-text');
        this.statusBarEl = document.getElementById('status-bar');
        this.importBtn = document.getElementById('btn-import') as HTMLButtonElement;
        this.importBtnText = document.getElementById('btn-import-text');
        this.uploadZone = document.getElementById('upload-zone');
        this.fileInput = document.getElementById('file-input') as HTMLInputElement;
        this.fileInfo = document.getElementById('file-info');
        this.fileName = document.getElementById('file-name');
        this.fileMeta = document.getElementById('file-meta');
        this.removeBtn = document.getElementById('btn-remove');
        this.errorBox = document.getElementById('error-box');
        this.errorTitle = document.getElementById('error-title');
        this.errorMessage = document.getElementById('error-message');
        this.progressContainer = document.getElementById('progress-container');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');
        this.successBox = document.getElementById('success-box');
        this.successText = document.getElementById('success-text');

        this.setupEventListeners();
    }

    /**
     * Setup all UI event listeners
     */
    private setupEventListeners(): void {
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

    /**
     * Handle file selection/drop
     */
    private async handleFile(file: File): Promise<void> {
        // Validate file extension
        if (!file.name.endsWith('.htfig')) {
            this.showError('Invalid File Type', 'Only .htfig files from the Chrome extension are accepted.');
            return;
        }

        this.currentFile = file;
        this.hideError();
        this.hideSuccess();

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

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            this.showError('File Read Error', message);
            this.clearFile();
        }
    }

    /**
     * Recursively count all layers including children
     */
    private countLayers(layers: unknown[]): number {
        let count = layers.length;
        for (const layer of layers) {
            if (layer && typeof layer === 'object' && 'children' in layer) {
                const children = (layer as { children?: unknown[] }).children;
                if (Array.isArray(children) && children.length > 0) {
                    count += this.countLayers(children);
                }
            }
        }
        return count;
    }

    /**
     * Read file content as text
     */
    private readFileContent(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /**
     * Clear current file and reset UI
     */
    private clearFile(): void {
        this.currentFile = null;
        this.parsedDocument = null;

        if (this.uploadZone) this.uploadZone.classList.remove('hidden');
        if (this.fileInfo) this.fileInfo.classList.add('hidden');
        if (this.importBtn) this.importBtn.disabled = true;
        if (this.fileInput) this.fileInput.value = '';

        this.hideError();
        this.hideSuccess();
        this.hideProgress();
        this.setState('idle', 'Ready');
    }

    /**
     * Show error message
     */
    private showError(title: string, message: string): void {
        this.hideSuccess();
        this.hideProgress();

        if (this.errorBox) {
            this.errorBox.classList.remove('hidden');
        }
        if (this.errorTitle) this.errorTitle.textContent = title;
        if (this.errorMessage) this.errorMessage.textContent = message;
    }

    /**
     * Hide error message
     */
    private hideError(): void {
        if (this.errorBox) this.errorBox.classList.add('hidden');
    }

    /**
     * Show success message
     */
    private showSuccess(message: string): void {
        this.hideError();
        this.hideProgress();

        if (this.successBox) {
            this.successBox.classList.remove('hidden');
        }
        if (this.successText) this.successText.textContent = message;
    }

    /**
     * Hide success message
     */
    private hideSuccess(): void {
        if (this.successBox) this.successBox.classList.add('hidden');
    }

    /**
     * Show progress bar
     */
    private showProgress(): void {
        this.hideError();
        this.hideSuccess();

        if (this.progressContainer) {
            this.progressContainer.classList.remove('hidden');
        }
    }

    /**
     * Hide progress bar
     */
    private hideProgress(): void {
        if (this.progressContainer) this.progressContainer.classList.add('hidden');
        this.updateProgress(0, 'Preparing import...');
    }

    /**
     * Update progress bar
     */
    public updateProgress(percent: number, message: string): void {
        if (this.progressFill) {
            this.progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        }
        if (this.progressText) {
            this.progressText.textContent = message;
        }
    }

    /**
     * Initiate file import to Figma
     */
    private importHtfigFile(): void {
        if (!this.parsedDocument) {
            this.showError('No File Loaded', 'Please select a .htfig file first.');
            return;
        }

        this.setState('processing', 'Importing layers...');
        this.showProgress();
        this.updateProgress(10, 'Sending to Figma...');

        // Update button text
        if (this.importBtnText) {
            this.importBtnText.textContent = 'Importing...';
        }

        // Get Options
        const enableAutoLayout = (document.getElementById('chk-autolayout') as HTMLInputElement)?.checked ?? true;

        // Send layers to Figma sandbox
        parent.postMessage({
            pluginMessage: {
                type: 'generate',
                data: this.parsedDocument.layers,
                enableAutoLayout: enableAutoLayout
            }
        }, '*');
    }

    /**
     * Set UI state and update status bar
     */
    public setState(state: UIState, message: string): void {
        this.currentState = state;

        if (!this.statusBarEl || !this.statusTextEl) return;

        this.statusTextEl.textContent = message;
        this.statusBarEl.setAttribute('data-state', state);

        // Update import button state
        if (this.importBtn && state !== 'processing') {
            this.importBtn.disabled = !this.parsedDocument;
        } else if (this.importBtn) {
            this.importBtn.disabled = true;
        }

        // Reset button text when not processing
        if (state !== 'processing' && this.importBtnText) {
            this.importBtnText.textContent = 'Import to Figma';
        }

        // Handle success state
        if (state === 'success') {
            this.hideProgress();
            this.showSuccess(message);
        }

        // Handle error state
        if (state === 'error') {
            this.hideProgress();
            this.showError('Import Error', message);
        }
    }

    /**
     * Handle progress update from sandbox
     */
    public handleProgress(percent: number, message: string): void {
        this.showProgress();
        this.updateProgress(percent, message);
    }
}

// Initialize UI Manager
const ui = new UIManager();

// Listen for messages from the Sandbox
onmessage = (event) => {
    const msg = event.data.pluginMessage as UIAction;

    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'status':
            // Parse progress percentage from message if present
            const percentMatch = msg.message.match(/(\d+)%/);
            if (percentMatch) {
                const percent = parseInt(percentMatch[1], 10);
                ui.handleProgress(percent, msg.message);
            } else {
                ui.setState('processing', msg.message);
            }
            break;

        case 'complete':
            ui.setState('success', msg.message);
            break;

        case 'error':
            ui.setState('error', msg.message);
            break;

        case 'generate':
            ui.setState('success', 'Import Complete');
            break;
    }
};

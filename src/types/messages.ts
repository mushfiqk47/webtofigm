import { LayerNode } from './layer-node';

export type PluginMessage =
    | { type: 'IMPORT-URL'; url: string }
    | { type: 'IMPORT-HTML'; html: string }
    | { type: 'NOTIFY'; message: string; error?: boolean }
    | { type: 'CONVERSION-COMPLETE' };

export type UIAction =
    | { type: 'generate'; data: LayerNode[]; enableAutoLayout?: boolean }
    | { type: 'status'; message: string }
    | { type: 'complete'; message: string }
    | { type: 'error'; message: string }
    | { type: 'warning'; message: string };

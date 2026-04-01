import type { Theme } from '../../shared/theme-types';

export interface TerminalEngineHandle {
	write(data: string): void;
	focus(): void;
	clear(): void;
	scrollToBottom(): void;
	search(query: string, options?: { caseSensitive?: boolean; regex?: boolean }): boolean;
	searchNext(): boolean;
	searchPrevious(): boolean;
	getSelection(): string;
	resize(): void;
	refresh(): void;
}

export interface TerminalEngineProps {
	sessionId: string;
	theme: Theme;
	fontFamily: string;
	fontSize?: number;
	onData?: (data: string) => void;
	onResize?: (cols: number, rows: number) => void;
	onTitleChange?: (title: string) => void;
}
